import type { GuardArg, Transition, TransitionConfig, TransitionEntry } from './types'

/** Look up the `on` entry for an event: current state first, falling back to `config.on`. */
export function lookupOn<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
>(
  config: TransitionConfig<State, Context, Event, Computed>,
  stateValue: State,
  type: Event['type'],
): TransitionEntry<State, Context, Event, Computed> | undefined {
  const onState = config.states[stateValue].on as
    | Record<string, TransitionEntry<State, Context, Event, Computed>>
    | undefined
  const onAny = config.on as
    | Record<string, TransitionEntry<State, Context, Event, Computed>>
    | undefined
  return onState?.[type] ?? onAny?.[type]
}

/**
 * Return the first transition whose guard passes. Normalizes the three entry forms
 * (object / bare fn / array) to a list; a bare fn becomes `{ actions: [fn] }` (guardless).
 */
export function resolve<State extends string, Context extends object, Event, Computed>(
  entry: TransitionEntry<State, Context, Event, Computed> | undefined,
  resolveGuard: (guard: GuardArg<Context, Event, Computed>) => boolean,
): Transition<State, Context, Event, Computed> | undefined {
  if (!entry) return undefined
  const list = Array.isArray(entry) ? entry : [entry]
  for (const el of list) {
    const t: Transition<State, Context, Event, Computed> =
      typeof el === 'function' ? { actions: [el] } : el
    if (!t.guard || resolveGuard(t.guard)) return t
  }
  return undefined
}
