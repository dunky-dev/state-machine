import { isDev } from './constants'
import type { Guard, GuardArg, GuardParams } from './types'

export function resolveGuard<Context extends object, Event, Computed>(
  guard: GuardArg<Context, Event, Computed>,
  params: GuardParams<Context, Event, Computed>,
  registry: Record<string, Guard<Context, Event, Computed>> | undefined,
): boolean {
  if (typeof guard === 'function') return guard(params)
  const fn = registry?.[guard]
  if (!fn) {
    const msg = `[machine] no guard "${guard}"`
    if (isDev) throw new Error(msg)
    console.warn(msg)
    return false
  }
  return fn(params)
}

export function makeGuardParams<Context extends object, Event, Computed>(
  context: Context,
  event: Event,
  computed: Computed,
  registry: Record<string, Guard<Context, Event, Computed>> | undefined,
): GuardParams<Context, Event, Computed> {
  const params: GuardParams<Context, Event, Computed> = {
    context,
    event,
    computed,
    guard: g => resolveGuard(g, params, registry),
  }
  return params
}

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
