import type { Guard, GuardArg } from './types'

/**
 * Guard combinators compose guards without naming every combination. Args are
 * GuardArgs (names or inline fns), each resolved through `params.guard()` (the
 * runtime's single guard channel), so they compose arbitrarily deep and
 * short-circuit.
 */

/** AND — true iff every guard passes. Zero args → true (empty intersection). */
export function and<Context extends object, Event, Computed = Record<string, never>>(
  ...guards: Array<GuardArg<Context, Event, Computed>>
): Guard<Context, Event, Computed> {
  return params => guards.every(g => params.guard(g))
}

/** OR — true iff any guard passes. Zero args → false (empty union). */
export function or<Context extends object, Event, Computed = Record<string, never>>(
  ...guards: Array<GuardArg<Context, Event, Computed>>
): Guard<Context, Event, Computed> {
  return params => guards.some(g => params.guard(g))
}

/** NOT — logical negation of a single guard. */
export function not<Context extends object, Event, Computed = Record<string, never>>(
  guard: GuardArg<Context, Event, Computed>,
): Guard<Context, Event, Computed> {
  return params => !params.guard(guard)
}
