import type { Machine, Reaction } from './types'

/**
 * Type helper for a reaction tuple — infers `Value` from the selector so the callback is typed.
 * A bare `[selector, callback]` in the `reactions` slot collapses `Value` to `any`.
 *
 * Curried so machine generics are fixed once while `Value` is inferred per reaction:
 *
 *   const reaction = makeReaction<State, Context, Event, Props>()
 *   const onOpenChange = reaction(
 *     m => m.matches('open'),
 *     (open, props) => props.onOpenChange?.({ open }),
 *   )
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
