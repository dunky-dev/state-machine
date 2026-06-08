import { useMemo, useRef, useSyncExternalStore } from 'react'
import type { EqualityFn, Machine } from '@render-experiment/machine-core'

/**
 * Fine-grained, selector-based subscription for leaf components.
 *
 * The selector reads from the machine directly (`m.context.x`, `m.matches(...)`)
 * so it auto-subscribes to EXACTLY the fields it touches. The component
 * re-renders only when the selected value changes — not on every machine
 * change. Changing one machine's cell wakes only the components whose selector
 * read that cell (O(readers)) — the path that makes thousands of leaf items
 * (each subscribing to its own slice) cheap.
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
  // once per machine; auto-tracks whatever the selector reads, value-deduped.
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
