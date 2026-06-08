import type { Adapter, TransitionConfig } from './types'

/**
 * Merge a platform `adapter` over `config.implementations`, adapter winning on
 * name collisions. Returns a NEW config — the input stays untouched, so one
 * agnostic config can be adapted for many platforms.
 *
 * A config names effects/actions but the implementation can be platform-specific
 * (a DOM listener vs. something else). withAdapter merges a platform's actions +
 * effects over the config's implementations; guards stay config-only (pure
 * predicates, identical on every platform). The agnostic config stays pure; the
 * platform is applied at the edge: machine(withAdapter(config, adapter)).
 */
export function withAdapter<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  config: TransitionConfig<State, Context, Event, Computed>,
  adapter: Adapter<Context, Event, Computed>,
): TransitionConfig<State, Context, Event, Computed> {
  const base = config.implementations
  return {
    ...config,
    implementations: {
      // Carry everything through (delays, guards, …); the adapter only layers
      // over actions + effects. Spreading base first keeps non-overridable
      // implementations (notably `delays`) intact.
      ...base,
      actions: { ...base?.actions, ...adapter.actions },
      effects: { ...base?.effects, ...adapter.effects },
    },
  }
}
