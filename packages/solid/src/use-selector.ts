import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained, selector-based subscription for leaf components.
 *
 * The selector reads from the machine directly (`m.context.x`, `m.matches(...)`)
 * and the returned accessor updates only when the selected VALUE changes — not
 * on every machine change.
 *
 * Returns a Solid Accessor (`() => T`): call it in JSX (`{open()}`) and that JSX
 * tracks it. The accessor is backed by a `createSignal` driven by the machine's
 * `select` — a value-deduped Selection. Every machine notify re-evaluates the
 * selector and value-compares the result (coarse bus + value compare, not
 * field-level dependency tracking); the signal is written only when the selected
 * value actually changed, so a change to an UNRELATED field never wakes this
 * reader. For a leaf list backed by ONE machine per item (the common shape),
 * each item's accessor wakes only for its own value — the O(readers) property
 * that makes thousands of leaves cheap.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   const isHL = useSelector(m, () => m.context.highlightedValue === value)
 *
 * Equality is `Object.is` by default; pass a custom `isEqual` for object
 * selections so a re-derived equal object doesn't push a new value.
 *
 * The Selection's own dedup AND the signal's equality both use `isEqual`, so an
 * object selection that returns a fresh `{...}` each evaluation stays stable as
 * long as `isEqual` deems it unchanged — no spurious updates.
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
): Accessor<T> {
  const selection = machine.select(selector)

  // Seed the signal with the current selected value. The signal's own equality
  // is the caller's `isEqual` (falling back to Solid's default Object.is), so
  // writing an equal value is a no-op — a second line of dedup behind the
  // Selection's bus-level one.
  const [value, setValue] = createSignal<T>(selection.value, { equals: isEqual })

  // The Selection fires its listener only when the selected value changes
  // (Object.is by default, or our `isEqual`); we push that into the signal.
  const off = selection.subscribe(next => setValue(() => next), isEqual)
  onCleanup(off)

  return value
}
