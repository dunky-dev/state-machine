import type { Action, ActionArg, ActionParams, OneOf, OneOfBranch, Transition } from './types'

/**
 * `oneOf([...])` is the conditional-action analog of fallthrough transitions:
 * the first branch whose guard passes runs its action list; the rest are
 * skipped. It lives inside an `actions` list — used where there's no transition
 * array to fall through (entry/exit lists, or alongside unconditional actions).
 *
 *   actions: [
 *     'alwaysRun',
 *     oneOf([
 *       { guard: 'isCheckbox', actions: ['toggle'] },
 *       { guard: 'isRadio',    actions: ['select'] },
 *       { actions: ['activate'] },   // guardless = fallback
 *     ]),
 *   ]
 */
export function oneOf<Context extends object, Event, Computed = Record<string, never>>(
  branches: Array<OneOfBranch<Context, Event, Computed>>,
): OneOf<Context, Event, Computed> {
  return { __oneOf: true, branches }
}

/**
 * Recognize a `oneOf(...)` sentinel in an actions list. Lives next to `oneOf`
 * (the only place that stamps `__oneOf`) so the marker has a single source of
 * truth. The runtime uses this to expand a oneOf into its winning branch.
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

/** A context patch, or a function of the action params that returns one. */
export type Patch<Context extends object, Event, Computed = Record<string, never>> =
  | Partial<Context>
  | ((params: ActionParams<Context, Event, Computed>) => Partial<Context>)

/**
 * `act(...)` — terse sugar for the two most common transition shapes: write some
 * context, optionally while moving to a target state.
 *
 * Each argument is a `Patch`: a static `Partial<Context>` or a function of the
 * action params (so it can read `event` / `context` / `computed`). Multiple
 * patches run in order.
 *
 *   // WRITE-ONLY → an Action (nests in `actions: [...]`, or stands alone as a
 *   // bare transition entry):
 *   focus:  act({ focused: true })
 *   set:    act(({ event }) => ({ value: event.value }))
 *   bump:   act({ touched: true }, ({ context }) => ({ n: context.n + 1 }))  // both, in order
 *
 *   // GO + DO → a Transition (a leading STATE-NAME string is the target):
 *   flip:   act('active', ({ context }) => ({ count: context.count + 1 }))
 *   submit: act('loading', { error: null })
 *
 * Disambiguation: if the first argument is a string it's the `target`, and the
 * rest are patches; otherwise every argument is a patch. (A patch is an object
 * or a function — never a string — so there's no ambiguity.) The write-only form
 * returns an `Action` so it composes inside `actions`; the target form returns a
 * `Transition`, which belongs in an `on` entry, not an `actions` list.
 *
 * TYPES NOTE — the RUNTIME of every form is correct, but TypeScript can't always
 * infer `Context` from a standalone `act(...)` call:
 *   - `act({ ...obj })`            ✅ Context inferred from the object literal.
 *   - `act(fn)` bare in `on.X`     ✅ Context flows from the entry's contextual type.
 *   - `act({...}, fn)` multi-patch ⚠️ Context inferred from the FIRST arg only.
 *   - `act('target', fn)`          ⚠️ Context binds to `string` (the arg TS sees),
 *                                     so `({ context }) => ...` loses its type.
 * This is the same limitation that makes XState's `assign` work only *inside* a
 * typed machine. The proper fix is a `setup<State, Context, Event>()` factory
 * that binds the types once and returns a Context-bound `act` (and guards/etc.);
 * then every form — including `act('active', fn)` — infers cleanly. Until that
 * exists, the fully-inferred forms are `act({...})` and a single bare `act(fn)`;
 * for the rest, annotate or use the explicit `{ target, actions: [...] }` shape.
 */
export function act<Context extends object, Event, Computed = Record<string, never>>(
  ...patches: Array<Patch<Context, Event, Computed>>
): Action<Context, Event, Computed>
export function act<
  State extends string,
  Context extends object,
  Event,
  Computed = Record<string, never>,
>(
  target: State,
  ...patches: Array<Patch<Context, Event, Computed>>
): Transition<State, Context, Event, Computed>
export function act<
  State extends string,
  Context extends object,
  Event,
  Computed = Record<string, never>,
>(
  ...args:
    | [State, ...Array<Patch<Context, Event, Computed>>]
    | Array<Patch<Context, Event, Computed>>
): Action<Context, Event, Computed> | Transition<State, Context, Event, Computed> {
  const hasTarget = typeof args[0] === 'string'
  const target = hasTarget ? (args[0] as State) : undefined
  const patches = (hasTarget ? args.slice(1) : args) as Array<Patch<Context, Event, Computed>>

  const action: Action<Context, Event, Computed> = params => {
    for (const patch of patches) {
      params.setContext(typeof patch === 'function' ? patch(params) : patch)
    }
  }

  return hasTarget ? { target, actions: [action] } : action
}
