import { onScopeDispose, shallowReadonly, shallowRef, type ShallowRef } from 'vue'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained subscription for leaf components — the ref updates only when the selected VALUE changes.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   const isHL = useSelector(m, () => m.context.highlightedValue === value)
 *
 * Equality is `Object.is` by default; pass `isEqual` for object selections so a
 * re-derived equal object doesn't bump the ref. The selection comes back as-is,
 * never wrapped in a reactive proxy, behind a readonly ref: it is derived state.
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
): Readonly<ShallowRef<T>> {
  const selection = machine.select(selector)
  const value = shallowRef(selection.value) as ShallowRef<T>

  // Disposes with the surrounding scope: a component's, or a bare effectScope().
  onScopeDispose(
    selection.subscribe(next => {
      value.value = next
    }, isEqual),
  )

  return shallowReadonly(value)
}
