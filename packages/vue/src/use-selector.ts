import { onScopeDispose, readonly, shallowRef, type DeepReadonly, type Ref } from 'vue'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained, selector-based subscription for leaf components.
 *
 * The selector reads from the machine directly (`m.context.x`, `m.matches(...)`)
 * and the returned ref updates only when the selected VALUE changes — not on
 * every machine change.
 *
 * Mechanism (not field-level auto-tracking): the machine's `select` is a coarse
 * bus. Every selection re-evaluates its selector on each machine notify and
 * value-compares the result; the ref is bumped only when its selected value
 * actually changed. So the WORK done per machine change is O(selectors on that
 * machine) — each re-evaluates — but the Vue UPDATES are O(selectors whose value
 * changed). For a leaf list backed by ONE machine per item (the common shape),
 * each item has a single selector on its own machine, so a change wakes only that
 * item. The deduping is what makes thousands of leaves cheap; it is value-based,
 * not dependency-graph based.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   const isHL = useSelector(m, () => m.context.highlightedValue === value)
 *
 * Equality is `Object.is` by default (the Selection's own dedup); pass a custom
 * `isEqual` for object selections so a re-derived equal object doesn't bump the
 * ref. Returns a readonly ref — the selection is derived state, not writable.
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
): Readonly<Ref<DeepReadonly<T>>> {
  // One Selection over the machine, value-deduped (coarse bus + value compare,
  // not field-level dependency tracking). Seed the ref with its current value so
  // the first read is correct before any change fires.
  const selection = machine.select(selector)
  const value = shallowRef(selection.value) as Ref<T>

  // The Selection only fires when the selected value changes (Object.is, or the
  // caller's `isEqual`), so the ref is bumped exactly on real changes — an
  // unrelated machine change never wakes this leaf. We pass `isEqual` through so
  // object selections dedup by value instead of identity.
  const off = selection.subscribe(next => {
    value.value = next
  }, isEqual)

  // Dispose with the surrounding effect scope (component unmount or an explicit
  // effectScope). The Selection is the consumer's to release, same as core's
  // `select`.
  onScopeDispose(off)

  return readonly(value)
}
