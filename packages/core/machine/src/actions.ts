import { isDev } from './constants'
import { makeGuardParams, resolveGuard } from './guards'
import type { Action, ActionArg, Actions, ActionParams, Guard, OneOf, OneOfBranch } from './types'

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
 * TYPES — `Context` is `NoInfer`, so it is NOT read off the patch argument; it
 * flows from the slot the action lands in (the `Actions<Context, …>` position in
 * a transition / `entry` / `exit` / `oneOf`). That means a bare `act({ x: 1 })`
 * or `act($ => ({ x: $.context.x + 1 }))` is fully typed against the surrounding
 * config — a wrong field or value errors at the call site, with NO per-call
 * generics, even when the config declares `computed` (the `Computed` param also
 * comes from the slot). The `$` in a function patch is likewise slot-typed.
 *
 * The only case still needing an explicit annotation is a STANDALONE `act(...)`
 * with no contextual slot (e.g. assigned to a bare `const` before being placed),
 * where there's nothing for `Context` to flow from — write
 * `act<Context, Event, Computed>(...)` there. Inside a config it's never needed.
 */
export function act<Context extends object, Event, Computed = Record<string, never>, Send = Event>(
  ...patches: Array<Patch<NoInfer<Context>, Event, Computed, Send>>
): Action<Context, Event, Computed, Send> {
  return params => {
    // Sequential by construction: setContext mutates the context object in
    // place (its identity never changes), so a later patch fn reading
    // `params.context` sees the earlier patches' writes — no local tracking.
    for (const patch of patches) {
      params.setContext(typeof patch === 'function' ? patch(params) : patch)
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

// -----------------------------------------------------------------------------
// Running actions
// -----------------------------------------------------------------------------

/**
 * Everything `runAction(s)` needs from the host machine to run an action: the
 * named registries (actions + guards, the latter for `oneOf` branch guards) and
 * live accessors for the params an action receives. Reads are LIVE — `context()`
 * and `computed()` re-read each call, so an action (and a later action in the
 * same list) always sees the current context, never a stale snapshot.
 */
export interface ActionHost<Context extends object, Event, Computed> {
  actions: Record<string, Action<Context, Event, Computed>> | undefined
  guards: Record<string, Guard<Context, Event, Computed>> | undefined
  context: () => Context
  computed: () => Computed
  setContext: (patch: Partial<Context>) => void
  send: (event: Event) => void
}

/**
 * Run one action arg for `event`. A `oneOf(...)` expands to its first
 * guard-passing branch (guardless = fallback); an inline fn runs directly; a
 * registered name resolves against `host.actions` (missing → throw in dev, warn
 * in prod). The action receives live context/computed + setContext/send.
 */
export function runAction<Context extends object, Event, Computed>(
  host: ActionHost<Context, Event, Computed>,
  action: ActionArg<Context, Event, Computed>,
  event: Event,
): void {
  if (isOneOf(action)) {
    const params = makeGuardParams(host.context(), event, host.computed(), host.guards)
    const branch = action.branches.find(b =>
      b.guard ? resolveGuard(b.guard, params, host.guards) : true,
    )
    if (branch) runActions(host, branch.actions, event)
    return
  }
  // past the oneOf guard, `action` is an inline fn or a registered name
  const named = action as Exclude<typeof action, OneOf<Context, Event, Computed>>
  const fn = typeof named === 'function' ? named : host.actions?.[named]
  if (!fn) {
    const msg = `[machine] no action "${action as string}"`
    if (isDev) throw new Error(msg)
    console.warn(msg)
    return
  }
  fn({
    context: host.context(),
    setContext: host.setContext,
    event,
    send: host.send,
    computed: host.computed(),
  })
}

/**
 * Run an `actions` / `entry` / `exit` slot: a single action or a list, in order.
 * Undefined slot is a no-op.
 */
export function runActions<Context extends object, Event, Computed>(
  host: ActionHost<Context, Event, Computed>,
  actions: Actions<Context, Event, Computed> | undefined,
  event: Event,
): void {
  if (!actions) return
  const list = Array.isArray(actions) ? actions : [actions]
  for (const action of list) runAction(host, action, event)
}
