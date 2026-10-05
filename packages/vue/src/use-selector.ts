import {
  computed,
  hasInjectionContext,
  inject,
  onScopeDispose,
  shallowRef,
  ssrContextKey,
  toValue,
  triggerRef,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
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
 * never wrapped in a reactive proxy, behind a computed ref: it is derived state.
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
): ComputedRef<T> {
  const equals = isEqual ?? Object.is
  // Triggered on every notification of the current machine. The computed re-runs the
  // selector lazily, where it is read — after Vue has finished patching the props — and
  // re-collects its reactive reads (a prop it compares against) on every run.
  const notified = shallowRef()
  let last: { value: T } | undefined
  const selected = computed(() => {
    void notified.value
    const next = selector()
    // An equal selection keeps the previous value's identity, so readers don't re-render.
    if (last && equals(last.value, next)) return last.value
    last = { value: next }
    return next
  })

  // A server render is one pass with nothing to follow, and Vue never disposes a scope
  // there: a subscription would outlive the request.
  if (hasInjectionContext() && inject(ssrContextKey, null)) return selected

  let unsubscribe = toValue(machine).subscribe(() => triggerRef(notified))
  // A ref or getter may swap the machine: the subscription moves with it.
  watch(
    () => toValue(machine),
    current => {
      unsubscribe()
      unsubscribe = current.subscribe(() => triggerRef(notified))
      triggerRef(notified)
    },
  )
  onScopeDispose(() => unsubscribe())

  return selected
}
