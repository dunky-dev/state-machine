import { createEffect, createStore, onCleanup, onSettled, reconcile } from 'solid-js'
import { connector, machine, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'

/**
 * One substrate-specific effect: a setup/teardown function plus the prop names
 * that re-run it. The tuple shape is identical across every target, so a
 * component's effects are authored once; `deps` are prop names (typed, so
 * typos are compile errors) — the authored list is the whole re-run contract.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * The generic Solid bridge: builds the machine + connector once, mirrors the
 * connector's snapshot into a fine-grained store, runs the lifecycle and the
 * component's effects. Returns the connect() api (reactive store proxy) and
 * the running machine.
 */
export function useMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props extends object,
  Api extends object,
  Computed = Record<string, never>,
>(
  createConfig: (props: Props) => TransitionConfig<State, Context, Event, Computed>,
  connect: Connect<State, Context, Event, Props, Api, Computed>,
  effects: ComponentEffect<ReturnType<typeof machine<State, Context, Event, Computed>>, Props>[],
  props: Props,
): { api: Api; machine: ReturnType<typeof machine<State, Context, Event, Computed>> } {
  // Seed with a plain copy, never the live props proxy: setProps value-dedups,
  // and a held proxy would compare equal to its own fresh spread and never wake.
  const service = machine(createConfig(props))
  const connection = connector(service, connect, { ...props })

  // Fine-grained mirror of the snapshot: reading `api.x` subscribes to that
  // leaf. (The cast mirrors Solid's NoFn guard — an api is never a function.)
  const [api, setApi] = createStore<Api>(connection.snapshot as Api extends Function ? never : Api)
  const off = connection.subscribe(() =>
    setApi(reconcile(connection.snapshot as Api extends Function ? never : Api)),
  )
  onCleanup(off)

  // The compute spread reads every prop, so any consumed prop change re-runs
  // this; setProps value-dedups.
  createEffect(
    () => ({ ...props }),
    snapshot => connection.setProps(snapshot),
  )

  // No connection.destroy(): connector and machine share this component's
  // lifetime and are GC'd together; destroy() is for standalone connectors.
  onSettled(() => {
    service.start()
    return () => service.stop()
  })

  // One effect per entry: compute tracks exactly the named deps (fresh array,
  // so apply fires on every dep change); the body runs untracked in apply, so
  // a prop it merely reads never becomes a hidden dependency.
  for (const [fn, deps] of effects) {
    createEffect(
      () => deps.map(key => props[key]),
      () => fn(service, props),
    )
  }

  return { api, machine: service }
}
