import {
  getCurrentInstance,
  inject,
  onScopeDispose,
  shallowReadonly,
  shallowRef,
  ssrContextKey,
  toValue,
  triggerRef,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained subscription for leaf components — the ref updates only when the selected VALUE changes.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   const isHL = useSelector(() => props.machine, () => props.machine.context.highlightedValue === props.value)
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
  machine: MaybeRefOrGetter<Machine<State, Context, Event, Computed>>,
  selector: () => T,
  isEqual?: EqualityFn<T>,
): Readonly<ShallowRef<T>> {
  const selected = shallowRef(selector()) as ShallowRef<T>
  // A server render is one pass with nothing to follow, and Vue never disposes a scope
  // there: a subscription would outlive the request.
  if (getCurrentInstance() && inject(ssrContextKey, null)) return shallowReadonly(selected)

  const equals = isEqual ?? Object.is
  // Triggered on every notification of the current machine. One watcher runs the selector
  // for both machine changes and its own reactive reads (a prop it compares against), so
  // every run re-collects those reads, whichever path triggered it.
  const notified = shallowRef()
  watch(
    () => {
      void notified.value
      return selector()
    },
    next => {
      if (!equals(selected.value, next)) selected.value = next
    },
    { flush: 'sync' },
  )

  const subscribe = (current: Machine<State, Context, Event, Computed>) =>
    current.subscribe(() => triggerRef(notified))
  let unsubscribe = subscribe(toValue(machine))
  // A ref or getter may swap the machine: move the subscription, then re-select.
  watch(
    () => toValue(machine),
    current => {
      unsubscribe()
      unsubscribe = subscribe(current)
      triggerRef(notified)
    },
  )
  onScopeDispose(() => unsubscribe())

  return shallowReadonly(selected)
}
