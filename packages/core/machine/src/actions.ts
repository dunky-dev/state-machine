import type { ActionArg, OneOf, OneOfBranch } from './types'

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
