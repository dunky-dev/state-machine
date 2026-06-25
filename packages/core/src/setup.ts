import type { Implementations, TransitionConfig, AnyString } from './types'

function chain<Context extends object, Event extends { type: string }, Computed>() {
  return {
    createMachine<
      State extends string,
      C extends object = Context,
      E extends { type: string } = Event,
      Cm = Computed,
    >(config: TransitionConfig<State, C, E, Cm>): TransitionConfig<State, C, E, Cm> {
      return config
    },

    config<const Registry extends Implementations<Context, Event, Computed>>(registries: Registry) {
      return {
        createMachine<State extends string>(
          config: Omit<
            TransitionConfig<
              State,
              Context,
              Event,
              Computed,
              keyof Registry['guards'] & AnyString,
              keyof Registry['actions'] & AnyString,
              keyof Registry['effects'] & AnyString,
              keyof Registry['delays'] & AnyString
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

/**
 * `setup` — authoring entry point.
 *
 *   // infer: types inferred from the literal
 *   setup.infer().createMachine({ initial, context, states })
 *
 *   // as: pin types, get compile-checked named guards/actions/effects/delays
 *   setup.as<Ctx, Ev>().config({ guards: { … }, actions: { … } }).createMachine({ … })
 *
 * The chain splits across calls because TypeScript has no partial type-argument inference —
 * passing one type arg forces you to pass all. Each call gets its own inference site.
 */
// Explicit return types required by --isolatedDeclarations (can't infer the chain shape).

/** Infer `State` / `Context` / `Event` from the config literal; no annotations. */
function setupInfer(): ReturnType<typeof chain<never, never, Record<string, never>>> {
  return chain<never, never, Record<string, never>>()
}

/** Pin `Context` / `Event` (/ `Computed`) explicitly; names become compile-checked via `.config(...)`. */
function setupAs<
  Context extends object = never,
  Event extends { type: string } = never,
  Computed = Record<string, never>,
>(): ReturnType<typeof chain<Context, Event, Computed>> {
  return chain<Context, Event, Computed>()
}

export const setup: { infer: typeof setupInfer; as: typeof setupAs } = {
  infer: setupInfer,
  as: setupAs,
}
