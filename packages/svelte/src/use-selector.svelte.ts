/// <reference types="svelte" />
import type { EqualityFn, Machine } from '@dunky.dev/state-machine'

/**
 * Fine-grained, selector-based subscription for leaf components.
 *
 * The selector reads from the machine directly (`m.context.x`, `m.matches(...)`)
 * and the returned value updates only when the selected VALUE changes — not on
 * every machine change.
 *
 * Mechanism (not field-level auto-tracking): the machine's `select` is a coarse
 * bus. Every selection re-evaluates its selector on each machine notify and
 * value-compares the result; the leaf is woken only when its selected value
 * actually changed. So the WORK per machine change is O(selectors on that
 * machine) — each re-evaluates — but the Svelte updates are O(selectors whose
 * value changed). For a leaf list backed by ONE machine per item (the common
 * shape), each item has a single selector on its own machine, so a change wakes
 * only that item. The deduping is what makes thousands of leaves cheap; it is
 * value-based, not dependency-graph based.
 *
 *   const open = useSelector(m, () => m.matches('open'))
 *   // in markup: {#if open.current} ... {/if}
 *
 * Returns an object with a single reactive `current` getter (the Svelte idiom
 * for a reactive value crossing a module boundary — a bare value can't carry its
 * reactivity across the `return`). Read `selection.current` in markup or a
 * `$derived`/`$effect` and it tracks like any rune-backed state.
 *
 * Equality is `Object.is` by default; pass a custom `isEqual` for object
 * selections so a fresh `{...}` each evaluation doesn't read as "changed".
 *
 * The subscription lives in an `$effect`, so it's set up when the effect first
 * runs and torn down automatically on destroy (Svelte calls the returned
 * cleanup). Unlike React, there's no getSnapshot-identity hazard to guard
 * against: the Selection's value-dedup gates the update, and `$state` only
 * notifies on reassignment, so an object selection with a matching `isEqual`
 * simply never reassigns.
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
  // One Selection over the selector; re-evaluated on every machine notify and
  // value-deduped (coarse bus + value compare, not field-level tracking).
  const selection = machine.select(selector)

  // The reactive cell. Seeded with the current selected value so the first read
  // is correct before any notify; reassigned only when the Selection fires —
  // which it does only on a real, deduped change.
  let value = $state(selection.value)

  $effect(() =>
    selection.subscribe(next => {
      value = next
    }, isEqual),
  )

  return {
    get current() {
      return value
    },
  }
}
