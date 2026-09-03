import { makeGuardParams } from './guards'
import type { Guard, GuardParams, Transition, TransitionConfig, TransitionEntry } from './types'

/** What a guard needs to run — the machine's action host satisfies it. */
export interface GuardHost<Context extends object, Event, Computed> {
  context: Context
  computed: Computed
  guards: Record<string, Guard<Context, Event, Computed>> | undefined
}

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
 * Return the first transition whose guard passes, across the three entry forms
 * (object / bare fn / array). A bare fn is a guardless `{ actions: fn }`.
 * Guard params are built once per resolve and only when a guard is met — the
 * common guardless send allocates nothing here.
 */
export function resolve<State extends string, Context extends object, Event, Computed>(
  entry: TransitionEntry<State, Context, Event, Computed> | undefined,
  event: Event,
  host: GuardHost<Context, Event, Computed>,
): Transition<State, Context, Event, Computed> | undefined {
  if (entry === undefined) return undefined
  if (!Array.isArray(entry)) {
    if (typeof entry === 'function') return { actions: entry }
    if (!entry.guard) return entry
    const params = makeGuardParams(host.context, event, host.computed, host.guards)
    return params.guard(entry.guard) ? entry : undefined
  }
  let params: GuardParams<Context, Event, Computed> | undefined
  for (const el of entry) {
    if (typeof el === 'function') return { actions: el }
    if (!el.guard) return el
    params ??= makeGuardParams(host.context, event, host.computed, host.guards)
    if (params.guard(el.guard)) return el
  }
  return undefined
}
