import type { GuardArg, Transition, TransitionConfig, TransitionEntry } from './types'

/**
 * Transition SELECTION: event → which transition fires. The front half of a
 * send (the back half — exit/actions/switch/entry/effects — stays in the machine
 * as it's intrinsically stateful). Pure over the config + an injected guard
 * resolver, so it has no machine coupling and is shared by both send paths (the
 * event queue and the `after`-timer dispatch, which otherwise duplicate it).
 */

/**
 * Look up the `on` entry for a live event: the current state's handler first,
 * falling back to any-state (`config.on`). Pure config lookup — resolves no
 * guards, runs nothing. Returns the raw entry (object / bare fn / array) or
 * undefined when nothing here handles this event.
 *
 * `EventMap` is keyed to the narrow event-type literals, so the entry it yields
 * for key `K` narrows `event` to that variant at AUTHORING time — but at RUNTIME
 * we index with the broad `event.type`, so we read it back through the union
 * `TransitionEntry` (`resolve` re-narrows by matching the actual event). The
 * single place that crosses the narrow→broad boundary.
 */
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
 * Pick the winning transition from a raw entry: normalize the three authoring
 * forms (object / bare fn / array) to a uniform list, and return the first whose
 * guard passes. A bare fn entry is a guardless, targetless transition: normalize
 * it to `{ actions: [fn] }` so the one "first passing guard wins" loop covers all
 * three forms. Guardless → always matches (so a bare fn is a fallback).
 *
 * Guard resolution is injected (`resolveGuard`) so this stays free of the
 * machine — the caller binds it to the runtime's guard registry + the params for
 * this event (built once at the call site, shared across the list).
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
