import {
  shallowReadonly,
  shallowRef,
  toValue,
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
  const equals = isEqual ?? Object.is
  const selected = shallowRef(selector()) as ShallowRef<T>
  // The ref is the one record of the last selection: both change paths dedupe against it.
  const accept = (next: T) => {
    if (!equals(selected.value, next)) selected.value = next
  }

  // The machine reports its own changes. Subscribing from an immediate watcher follows a
  // ref or getter that swaps the machine, and leaves nothing behind on the server, where
  // an immediate watcher runs once and stops.
  watch(
    () => toValue(machine),
    (current, previous, onCleanup) => {
      if (previous) accept(selector())
      onCleanup(current.subscribe(() => accept(selector())))
    },
    { immediate: true },
  )

  // Vue reports the reactive reads inside the selector — a prop it compares against — which
  // change without the machine noticing. The fresh tuple sidesteps the watcher's own change
  // check, which would compare against a stale value once the machine path has moved on.
  watch(
    (): [T] => [selector()],
    ([next]) => accept(next),
  )

  return shallowReadonly(selected)
}
