import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained, selector-based subscription for leaf components. The selector
 * reads the machine directly; the returned accessor updates only when the
 * selected VALUE changes (Object.is by default — pass `isEqual` for object
 * selections), so unrelated machine changes never wake the reader.
 *
 *   const open = useSelector(m, () => m.matches('open'))
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

  // Seed via the compute form on purpose: Solid 2.0's createSignal treats a
  // function first argument as a compute, so a function-typed selection passed
  // as a value would be misread. The compute has no reactive sources — it runs
  // once; later changes arrive through the subscription.
  const [value, setValue] = createSignal<T>(() => selection.value, { equals: isEqual })

  const off = selection.subscribe(next => setValue(() => next), isEqual)
  onCleanup(off)

  return value
}
