import { untrack } from 'svelte'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained, selector-based subscription for leaf components. The selector
 * reads the machine directly; `current` updates only when the selected VALUE
 * changes (Object.is by default — pass `isEqual` for object selections), so
 * unrelated machine changes never wake the reader. Call it while a component
 * initializes.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   // {#if open.current} … {/if}
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
): { readonly current: T } {
  // A send can come from inside any effect: evaluating the selector for it
  // untracked keeps that effect from depending on what the selector reads.
  const selection = machine.select(() => untrack(selector))

  // Raw: the value as the selector returned it, never proxied.
  let current = $state.raw(selection.value)
  // A pre-effect runs synchronously here (and never on the server), so this
  // listens before a child's mount effect can send. The tracked read makes
  // the props the selector closes over deps: a change re-seeds both the value
  // and the dedup baseline.
  $effect.pre(() => {
    current = selector()
    return selection.subscribe(next => (current = next), isEqual)
  })

  return {
    get current() {
      return current
    },
  }
}
