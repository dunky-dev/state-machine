import type { TransitionConfig } from './types'

/**
 * Identity helper for authoring a config as a standalone const with full
 * type-checking and inference — no manual generics. Returns the config
 * unchanged; its only job is to apply the `TransitionConfig` constraint so the
 * literal is checked (typos in `initial`, invalid `target`s, wrong param shapes
 * all error here) and its narrow types are captured for `machine()`.
 *
 *   const cfg = config({ initial: 'closed', context: {}, states: { ... } })
 *   const m = machine(cfg)
 */
export function config<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  c: TransitionConfig<State, Context, Event, Computed>,
): TransitionConfig<State, Context, Event, Computed> {
  return c
}
