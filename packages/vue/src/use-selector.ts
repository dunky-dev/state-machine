import { onScopeDispose, readonly, shallowRef, type DeepReadonly, type Ref } from 'vue'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained subscription for leaf components — the ref updates only when the selected VALUE changes.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   const isHL = useSelector(m, () => m.context.highlightedValue === value)
 *
 * Equality is `Object.is` by default; pass `isEqual` for object selections so a
 * re-derived equal object doesn't bump the ref. Returns a readonly ref — the
 * selection is derived state, not writable.
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
  // Seed with the current value so the first read is correct before any change fires.
  const selection = machine.select(selector)
  const value = shallowRef(selection.value) as Ref<T>

  const off = selection.subscribe(next => {
    value.value = next
  }, isEqual)

  // Dispose with the surrounding effect scope (component unmount or an explicit effectScope).
  onScopeDispose(off)

  return readonly(value)
}
