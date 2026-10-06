import {
  computed,
  hasInjectionContext,
  inject,
  isRef,
  onScopeDispose,
  ssrContextKey,
  toRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'
import { createTrigger } from './tracking'

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
): Readonly<Ref<T>> {
  // A server render is one pass. Nothing is subscribed there — Vue never disposes a scope on
  // the server, so a listener would outlive the request — which leaves nothing to refresh a
  // cached value: every read runs the selector.
  if (hasInjectionContext() && inject(ssrContextKey, null)) return toRef(selector)

  const equals = isEqual ?? Object.is
  // Triggered on every notification of the current machine. The computed re-runs the selector
  // lazily, where it is read — after Vue has finished patching the props — and re-collects its
  // reactive reads (a prop it compares against) on every run.
  const { track, trigger } = createTrigger()
  // Held here rather than read from the getter's `previous` argument, which early Vue 3.5
  // releases never passed.
  let last: { value: T } | undefined
  const selected = computed(() => {
    track()
    const next = selector()
    // An equal selection keeps the previous value's identity, so readers don't re-render.
    if (last && equals(last.value, next)) return last.value
    last = { value: next }
    return next
  })

  let unsubscribe = toValue(machine).subscribe(trigger)
  // A ref or getter may swap the machine: the subscription moves with it.
  if (isRef(machine) || typeof machine === 'function') {
    watch(
      () => toValue(machine),
      current => {
        unsubscribe()
        unsubscribe = current.subscribe(trigger)
        trigger()
      },
    )
  }
  onScopeDispose(() => unsubscribe())

  return selected
}
