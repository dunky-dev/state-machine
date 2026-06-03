import type { OneOf, OneOfBranch } from './types'

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
export function oneOf<Context, Event, Computed = Record<string, never>>(
  branches: Array<OneOfBranch<Context, Event, Computed>>,
): OneOf<Context, Event, Computed> {
  return { __oneOf: true, branches }
}
