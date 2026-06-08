/**
 * The event the engine synthesizes when it boots a state's effects (and the
 * watchers) on start(). Dotted so it can't collide with a domain event;
 * exported so a boot effect can branch on it: `event.type === MACHINE_INIT`.
 */
export const MACHINE_INIT = 'machine.init' as const

/**
 * Dev-only behavior switch. A missing named guard/action/effect/delay throws in
 * dev (loud, fail-fast) and warns + degrades in prod. Shared by every module
 * that resolves a name so the rule lives in one place.
 */
export const isDev = process.env.NODE_ENV !== 'production'
