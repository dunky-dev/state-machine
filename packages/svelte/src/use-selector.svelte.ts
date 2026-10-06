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
  // Through a derived, so only a different machine re-subscribes.
  const target = $derived.by(typeof machine === 'function' ? machine : () => machine)

  // One dedup baseline for both triggers: the selector's latest value.
  let prev = untrack(selector)
  let current = $state.raw(prev)
  // Pre-effects never run on the server: there, `current` reads the selector.
  let live = false
  let retries = 0
  let retry = $state(0)

  // Tracked: re-runs when a prop the selector closes over changes, and to
  // retry a selector that threw during a notification.
  $effect.pre(() => {
    void retry
    const next = selector()
    if (!isEqual(prev, next)) current = next
    prev = next
  })

  // Runs synchronously here, so it listens before a child's mount effect can
  // send. The selector runs untracked: a send can come from inside any effect.
  $effect.pre(() => {
    const unsubscribe = target.subscribe(() => {
      let next: T
      try {
        next = untrack(selector)
      } catch {
        // A reader its parent drops on this very change can't select from the
        // new state. Retry in the next flush, which skips a destroyed reader,
        // instead of throwing out of the sender's send().
        retry = ++retries
        return
      }
      if (isEqual(prev, next)) return
      prev = next
      current = next
    })
    live = true
    return () => {
      live = false
      unsubscribe()
    }
  })

  return {
    get current() {
      return live ? current : untrack(selector)
    },
  }
}
