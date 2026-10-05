import { untrack } from 'svelte'
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained, selector-based subscription for leaf components. The selector
 * reads the machine directly; `current` updates only when the selected VALUE
 * changes (Object.is by default — pass `isEqual` for object selections), so
 * unrelated machine changes never wake the reader. Call it while a component
 * initializes; pass the machine as a getter when it can change (a prop).
 *
 *   const open = useSelector(() => machine, () => machine.matches('open'))
 *   // {#if open.current} … {/if}
 */
export function useSelector<
  State extends string,
  Context extends object,
  T,
  Event extends { type: string } = { type: string },
  Computed = Record<string, never>,
>(
  machine:
    | Machine<State, Context, Event, Computed>
    | (() => Machine<State, Context, Event, Computed>),
  selector: () => T,
  isEqual: EqualityFn<T> = Object.is,
): { readonly current: T } {
  const source = typeof machine === 'function' ? machine : () => machine

  // One dedup baseline for both triggers: the selector's latest value. Seeded
  // here because pre-effects never run on the server.
  let prev = untrack(selector)
  let current = $state.raw(prev)

  // Tracked: re-runs when a prop the selector closes over changes.
  $effect.pre(() => {
    const next = selector()
    if (!isEqual(prev, next)) current = next
    prev = next
  })

  // Runs synchronously here, so it listens before a child's mount effect can
  // send; re-subscribes when the getter hands over another machine. The
  // selector runs untracked: a send can come from inside any effect.
  $effect.pre(() =>
    source().subscribe(() => {
      const next = untrack(selector)
      if (isEqual(prev, next)) return
      prev = next
      current = next
    }),
  )

  return {
    get current() {
      return current
    },
  }
}
