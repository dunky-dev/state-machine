import type { Implementations, TransitionConfig, AnyString } from './types'

/**
 * `setup()` — the authoring entry point, with two paths off one call:
 *
 *   // lightweight: no registries, types inferred from the literal, names loose
 *   const cfg = setup().createMachine({ initial, context, states })
 *
 *   // checked: name a registry first, then every guard/action/effect/delay
 *   // reference in the config is checked + autocompleted against its keys
 *   const { createMachine } = setup<Ctx, Ev, Computed>().config({ ... })
 *   createMachine({ ... })
 *
 * (`setup<Ctx,Ev>().createMachine(...)` — types but no `.config` — compiles, but
 * the names are NOT checked; use `.config(...)` to get checking.)
 *
 * The checked chain in full:
 *
 *   const { createMachine } = setup<Ctx, Ev, Computed>().config({
 *     guards:  { isOpen: ({ context }) => context.open },
 *     actions: { setId:  ({ context }) => store.set(context.id) },
 *     effects: { track:  ({ send }) => store.subscribe(...) },
 *     delays:  { openDelay: ({ context }) => context.openMs },
 *   })
 *
 *   createMachine({
 *     initial: 'closed',
 *     context: { ... },
 *     states: {
 *       open: {
 *         entry:   ['setId'],            // ✅ checked against `actions`
 *         effects: ['track'],            // ✅ checked against `effects`
 *         after:   { openDelay: { ... } }, // ✅ checked against `delays` (numbers still ok)
 *         on: { close: { target: 'closed', guard: 'isOpen' } }, // ✅ checked against `guards`
 *       },
 *     },
 *   })
 *
 * Plain `config({ states, implementations })` types every name as a loose string
 * (a typo only throws at runtime) — because `states` and `implementations` infer
 * together in one object, neither can constrain the other's names. The chain
 * orders the inferences so the registries are known before the states reference
 * them, which is what makes the names checkable:
 *
 *   1. `setup<Ctx, Ev, Computed>()` — pin the machine types. They can't be inferred
 *      from a registry (TS does no partial type-arg inference), so they're explicit
 *      here, like `config`'s.
 *   2. `.config(registries)` — infer the registry object (`const`, so keys stay
 *      literal); its callbacks are typed from step 1's Ctx/Ev.
 *   3. `.createMachine(config)` — the config, with every guard/action/effect/delay
 *      name now checked + autocompleted against step 2's keys.
 *
 * `createMachine` returns the same `TransitionConfig` shape `machine()` consumes
 * (registries merged into `implementations`), so the rest of the pipeline is
 * unchanged.
 */
export function setup<
  Context extends object = never,
  Event extends { type: string } = never,
  Computed = Record<string, never>,
>() {
  return {
    /**
     * Build a config directly — no named-impl registries, names left loose
     * (the lightweight path, replacing the old `config()`). With no type args on
     * `setup()`, `State` / `Context` / `Event` are inferred from the literal.
     * For checked names, go through `.config(registries)` first instead.
     */
    createMachine<
      State extends string,
      C extends object = Context,
      E extends { type: string } = Event,
      Cm = Computed,
    >(config: TransitionConfig<State, C, E, Cm>): TransitionConfig<State, C, E, Cm> {
      return config
    },

    config<const Registry extends Implementations<Context, Event, Computed>>(registries: Registry) {
      type GuardName = keyof Registry['guards'] & AnyString
      type ActionName = keyof Registry['actions'] & AnyString
      type EffectName = keyof Registry['effects'] & AnyString
      type DelayName = keyof Registry['delays'] & AnyString

      return {
        /**
         * Build the config with all four name slots checked against the registries
         * from `.config(...)`. `initial` / `State` are inferred from `states`; the
         * registries are merged into `implementations` so `machine()` resolves the
         * names at runtime exactly as before.
         */
        createMachine<State extends string>(
          config: Omit<
            TransitionConfig<
              State,
              Context,
              Event,
              Computed,
              GuardName,
              ActionName,
              EffectName,
              DelayName
            >,
            'implementations'
          >,
        ): TransitionConfig<State, Context, Event, Computed> {
          return { ...config, implementations: registries } as TransitionConfig<
            State,
            Context,
            Event,
            Computed
          >
        },
      }
    },
  }
}
