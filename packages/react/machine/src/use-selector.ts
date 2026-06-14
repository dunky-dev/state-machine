import { useMemo, useRef, useSyncExternalStore } from 'react'
import type { EqualityFn, Machine } from '@chimba-ui/machine-core'

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

  // One Selection over a stable wrapper that reads the current selector. Built
  // once per machine; re-evaluated on every machine notify and value-deduped
  // (coarse bus + value compare, not field-level dependency tracking).
  const selectorMemo = useMemo(() => machine.select(() => selectorRef.current()), [machine])

  return useSyncExternalStore(
    onStoreChange => selectorMemo.subscribe(() => onStoreChange(), isEqual),
    // getSnapshot evaluates the selector DIRECTLY rather than reading
    // selectorMemo.value. `.value` lazily builds a preact computed on first
    // read, and React calls getSnapshot during every leaf's mount render — so
    // routing through `.value` would allocate a computed node per leaf at mount.
    // The snapshot read doesn't need tracking (only `subscribe` does), so a
    // plain eval is correct and skips that per-leaf allocation. The Selection's
    // reactive node is still built lazily if anyone reads `.value` elsewhere.
    () => selectorRef.current(),
    () => selectorRef.current(),
  )
}
