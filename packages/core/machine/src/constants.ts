/**
 * The event the engine synthesizes when it boots a state's effects (and the
 * watchers) on start(). Dotted so it can't collide with a domain event;
 * exported so a boot effect can branch on it: `event.type === MACHINE_INIT`.
 */
export const MACHINE_INIT = 'machine.init' as const
