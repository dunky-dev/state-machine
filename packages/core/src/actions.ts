import type { Action, ActionArg, ActionParams, OneOf, OneOfBranch } from './types'

/** A context patch, or a function of the action params that returns one. */
export type Patch<Context extends object, Event, Computed = Record<string, never>, Send = Event> =
  | Partial<Context>
  | ((params: ActionParams<Context, Event, Computed, Send>) => Partial<Context>)

/**
 * `act(...patches)` — write-sugar for the most common action: setting context.
 *
 *   actions: act({ pressed: true })
 *   actions: act($ => ({ n: $.context.n + 1 }))
 *
 * Multiple patches apply in order; later fn patches see earlier writes.
 * `Context` is `NoInfer` — it flows from the surrounding slot, not the argument,
 * so no per-call generics are needed inside a config. Only a standalone `act(...)`
 * outside any config slot needs explicit `act<Context, Event, Computed>(...)`.
 */
export function act<Context extends object, Event, Computed = Record<string, never>, Send = Event>(
  ...patches: Array<Patch<NoInfer<Context>, Event, Computed, Send>>
): Action<Context, Event, Computed, Send> {
  return params => {
    for (const patch of patches) {
      params.setContext(typeof patch === 'function' ? patch(params) : patch)
    }
  }
}

/**
 * `oneOf(...branches)` — runs the first branch whose guard passes; the rest are skipped.
 * A guardless branch always matches — use it last as the fallback.
 */
export function oneOf<Context extends object, Event, Computed = Record<string, never>>(
  ...branches: Array<OneOfBranch<Context, Event, Computed>>
): OneOf<Context, Event, Computed> {
  return { __oneOf: true, branches }
}

export function isOneOf<Context extends object, Event, Computed>(
  action: ActionArg<Context, Event, Computed>,
): action is OneOf<Context, Event, Computed> {
  return (
    typeof action === 'object' &&
    action !== null &&
    (action as { __oneOf?: boolean }).__oneOf === true
  )
}
