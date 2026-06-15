import { useMemo, useRef, useSyncExternalStore } from 'react'
import type { EqualityFn, Machine } from '@chimba-ui/state-machine'

/**
 * Fine-grained, selector-based subscription for leaf components.
 *
 * The selector reads from the machine directly (`m.context.x`, `m.matches(...)`)
 * and the component re-renders only when the selected VALUE changes — not on
 * every machine change.
 *
 * Mechanism (not field-level auto-tracking): the machine's `select` is a coarse
 * bus. Every selection re-evaluates its selector on each machine notify and
 * value-compares the result; the component is woken only when its selected
 * value actually changed. So the WORK done per machine change is O(selectors on
 * that machine) — each re-evaluates — but the React RE-RENDERS are O(selectors
 * whose value changed). For a leaf list backed by ONE machine per item (the
 * common shape), each item has a single selector on its own machine, so a
 * change wakes only that item. The deduping is what makes thousands of leaves
 * cheap; it is value-based, not dependency-graph based.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   const isHL = useSelector(m, () => m.context.highlightedValue === value)
 *
 * Equality is `Object.is` by default; pass a custom `isEqual` for object
 * selections.
 *
 * The selector and isEqual are kept in refs and read through a STABLE inner
 * Selection, so a per-render-fresh `selector` (e.g. one closing over a `value`
 * prop) always evaluates its latest form WITHOUT re-creating the Selection or
 * re-subscribing every render. Only `m` changing rebuilds the subscription.
 *
 * getSnapshot returns a value cached in a ref, refreshed only when the selected
 * value actually changes (Object.is, or the caller's `isEqual`). That stable
 * identity is REQUIRED: useSyncExternalStore re-renders whenever successive
 * getSnapshot results differ by Object.is, so an object selection that returned
 * a fresh `{...}` each call would re-render forever. The cache makes object
 * selections safe (and `isEqual` the way to dedup them); primitives are
 * unaffected.
 */
export function useSelector<
  State extends string,
  Context extends object,
  T,
  Event extends { type: string } = { type: string },
  Computed = Record<string, never>,
>(
  machine: Machine<State, Context, Event, Computed>,
  selector: () => T,
  isEqual?: EqualityFn<T>,
): T {
  // Keep the LATEST selector in a ref so a leaf passing a fresh closure each
  // render (e.g. one closing over a changing `value` prop) always evaluates its
  // current form, WITHOUT rebuilding the Selection or re-subscribing. Only the
  // selector needs this — `isEqual` is read once at subscribe time, not per
  // change, so it can be closed over directly (one fewer ref + per-render write
  // per leaf, which adds up across thousands of leaves on mount).
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  // Keep the LATEST isEqual in a ref too: getSnapshot (below) consults it to
  // decide whether a freshly-evaluated value is "the same" as the cached one.
  // It can change identity per render (an inline arrow), so reading it through a
  // ref keeps getSnapshot stable without re-subscribing.
  const isEqualRef = useRef(isEqual)
  isEqualRef.current = isEqual

  // One Selection over a stable wrapper that reads the current selector. Built
  // once per machine; re-evaluated on every machine notify and value-deduped
  // (coarse bus + value compare, not field-level dependency tracking).
  const selectorMemo = useMemo(() => machine.select(() => selectorRef.current()), [machine])

  // Cache the last value getSnapshot returned. useSyncExternalStore compares
  // successive getSnapshot results by Object.is and re-renders whenever they
  // differ — so getSnapshot MUST stay referentially stable while the selected
  // value is unchanged. A raw `selectorRef.current()` breaks that for object
  // selections: a fresh `{...}` every call is never Object.is-equal to the last,
  // so React would re-render forever. We hold the last value in a ref and only
  // replace it when the newly-evaluated value actually changed — Object.is by
  // default, or the caller's `isEqual` for object selections. Primitives are
  // unaffected (Object.is on equal primitives is true, so the cache is a no-op).
  const cache = useRef<{ value: T } | null>(null)
  const getSnapshot = (): T => {
    const next = selectorRef.current()
    const eq = isEqualRef.current ?? Object.is
    if (cache.current && eq(cache.current.value, next)) return cache.current.value
    cache.current = { value: next }
    return next
  }

  return useSyncExternalStore(
    // The Selection's value-dedup still gates the bus → React notification (so a
    // change to an UNRELATED field doesn't even wake this leaf). getSnapshot's
    // cache is the second line of defense: it keeps the returned identity stable
    // so React itself doesn't re-render on an equal value. The two together give
    // both "don't wake on unrelated changes" and "don't loop on object identity".
    onStoreChange => selectorMemo.subscribe(() => onStoreChange(), isEqual),
    getSnapshot,
    getSnapshot,
  )
}
