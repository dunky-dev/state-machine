import type { Machine, Reaction } from './types'

/**
 * Identity builder for a single reaction tuple that recovers the
 * `selector → callback` value link inference can't get from a bare array.
 *
 * Written inline, `[selector, callback]` lands in the `reactions?: Reaction<…,
 * any>[]` slot, so `Value` collapses to `any` and the callback's first param is
 * untyped. `reaction(...)` instead INFERS `Value` from the selector's return and
 * binds it to the callback — a typo in either half errors at the call site.
 *
 * Curried so the machine generics are fixed once per component (they can't be
 * inferred from the tuple) while `Value` is inferred per reaction:
 *
 *   const reaction = makeReaction<State, Context, Event, Props>()
 *   const onOpenChange = reaction(
 *     m => m.matches('open') || m.matches('closing'),  // Value = boolean (inferred)
 *     (open, props) => props.onOpenChange?.({ open }),  // open: boolean
 *   )
 *   connect.reactions = [onOpenChange]
 *
 * Returns the tuple unchanged — purely a type-level helper.
 */
export function makeReaction<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props,
  Computed = Record<string, never>,
>() {
  return <Value>(
    selector: (machine: Machine<State, Context, Event, Computed>) => Value,
    callback: (value: Value, props: Props) => void,
  ): Reaction<State, Context, Event, Props, Computed, Value> => [selector, callback]
}
