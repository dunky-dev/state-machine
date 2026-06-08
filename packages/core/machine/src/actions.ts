import type { Action, ActionArg, ActionParams, OneOf, OneOfBranch } from './types'

/**
 * `act` + `oneOf` — the two authoring helpers that live inside an `actions`
 * (or `entry` / `exit`) list. Everything structural (`target`, `guard`) stays on
 * the plain transition object; these two only ever describe what an action *does*.
 */

/** A context patch, or a function of the action params that returns one. */
export type Patch<Context extends object, Event, Computed = Record<string, never>, Send = Event> =
  | Partial<Context>
  | ((params: ActionParams<Context, Event, Computed, Send>) => Partial<Context>)

/**
 * `act(...patches)` — write-sugar for the most common action: setting context.
 * It drops the `$ => $.setContext(...)` wrapper, so a patch reads as data:
 *
 *   actions: act({ pressed: true, ripple: true })            // one or many fields
 *   actions: act($ => ({ n: $.context.n + 1 }))              // derived from params
 *   actions: act({ touched: true }, $ => ({ n: $.context.n + 1 }))  // sequential
 *
 * Each arg is a static patch or a `$ => patch` fn. Multiple patches are applied
 * **in order**, each via its own `setContext` — so a later patch fn sees the
 * writes of the earlier ones. `act` returns a normal `Action`, so it slots
 * anywhere an action does: a transition's `actions`, an `entry`/`exit` list, or a
 * `oneOf` branch's `actions`. It only ever WRITES — `target`/`guard` live on the
 * surrounding transition, never on `act`.
 *
 * TYPES NOTE — a single `act({...})` or `act($ => ({...}))` infers `Context` from
 * its slot, but a MIXED multi-patch call (`act({...}, $ => ({...}))`) infers
 * `Context` from the FIRST arg only, so the later fn's `$` loses fields. Annotate
 * such a call — `act<Context, Event>({...}, $ => ({...}))` — or split it into two
 * `act`s in the list. (The same limitation as XState's `assign` outside `setup`.)
 */
export function act<Context extends object, Event, Computed = Record<string, never>, Send = Event>(
  ...patches: Array<Patch<Context, Event, Computed, Send>>
): Action<Context, Event, Computed, Send> {
  return params => {
    // `params.context` is the snapshot captured when this action started, and the
    // engine swaps in a fresh context object on each setContext (copy-on-write) —
    // so a later patch fn reading the captured reference would miss earlier writes.
    // Track the running context locally and hand each fn a params view of it, so
    // patches are truly sequential (a later one sees the earlier ones).
    let context = params.context
    for (const patch of patches) {
      const next = typeof patch === 'function' ? patch({ ...params, context }) : patch
      params.setContext(next)
      context = { ...context, ...next }
    }
  }
}

/**
 * `oneOf(...branches)` — the conditional-action analog of a fallthrough
 * transition: the first branch whose guard passes runs its actions; the rest are
 * skipped. It lives inside an `actions` list (a transition's, or an `entry` /
 * `exit`) where there's no transition array to fall through.
 *
 * Each branch is a plain `{ guard?, actions }` object — the same shape as a
 * transition, minus `target` (a conditional WRITE never moves state; state
 * choice is the surrounding transition's job). A guardless branch always matches,
 * so put it last as the fallback. `actions` takes the usual vocabulary —
 * `act(...)`, a raw fn, a named action, or a nested `oneOf` — as a single value or
 * a list (the runtime normalizes when it runs them).
 *
 *   actions: [
 *     act({ ariaPressed: true }),
 *     oneOf(
 *       { guard: $ => $.context.variant === 'primary', actions: act({ shadow: 'lg' }) },
 *       { guard: $ => $.context.variant === 'ghost',   actions: act({ shadow: 'none' }) },
 *       { actions: act({ shadow: 'md' }) },   // guardless = fallback
 *     ),
 *   ]
 */
export function oneOf<Context extends object, Event, Computed = Record<string, never>>(
  ...branches: Array<OneOfBranch<Context, Event, Computed>>
): OneOf<Context, Event, Computed> {
  return { __oneOf: true, branches }
}

/**
 * Recognize a `oneOf(...)` sentinel in an actions list. The runtime uses this to
 * expand a oneOf into its winning branch. Lives next to `oneOf` (the only place
 * that stamps `__oneOf`) so the marker has a single source of truth.
 *
 * Generic over the action-arg union so it narrows to the SAME Context/Event/
 * Computed as the value passed in (rather than defaulting to `unknown`), keeping
 * `branch.actions` correctly typed at the call site.
 */
export function isOneOf<Context extends object, Event, Computed>(
  action: ActionArg<Context, Event, Computed>,
): action is OneOf<Context, Event, Computed> {
  return (
    typeof action === 'object' &&
    action !== null &&
    (action as { __oneOf?: boolean }).__oneOf === true
  )
}
