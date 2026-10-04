import { untrack } from 'svelte'
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
 * The generic Svelte bridge: builds the machine + connector once, mirrors the
 * connector's snapshot into `api`, runs the lifecycle and the component's
 * effects. Call it while a component initializes; `props` is a getter
 * (`() => props`) so later changes keep flowing in.
 */
export function useMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props extends object,
  Api,
  Computed = Record<string, never>,
>(
  createConfig: (props: Props) => TransitionConfig<State, Context, Event, Computed>,
  connect: Connect<State, Context, Event, Props, Api, Computed>,
  effects: ComponentEffect<ReturnType<typeof machine<State, Context, Event, Computed>>, Props>[],
  props: () => Props,
): {
  readonly api: Api
  readonly machine: ReturnType<typeof machine<State, Context, Event, Computed>>
} {
  // Seed with a plain copy, never the live props proxy: setProps value-dedups,
  // and a held proxy would compare equal to itself and never wake.
  const initialProps = { ...props() }
  const service = machine(createConfig(initialProps))
  const connection = connector(service, connect, initialProps)

  // Raw: the connector already memoizes the snapshot; a deep proxy would only
  // copy it and change its identity.
  let api = $state.raw(connection.snapshot)
  // A pre-effect runs synchronously here (and never on the server), so this
  // listens before a child's mount effect — which runs first — can send.
  $effect.pre(() => connection.subscribe(() => (api = connection.snapshot)))

  // The spread reads every prop, so any change re-runs this; setProps value-dedups.
  $effect(() => connection.setProps({ ...props() }))

  // No connection.destroy(): connector and machine share this component's
  // lifetime and are GC'd together; destroy() is for standalone connectors.
  $effect(() =>
    untrack(() => {
      service.start()
      return () => service.stop()
    }),
  )

  // One effect per entry, re-run only when a named dep's VALUE changes: a
  // $derived per dep dedups it whatever the getter reads to build the props.
  // The body runs untracked, so a prop it merely reads never becomes a dep.
  for (const [fn, deps] of effects) {
    const depValues = deps.map(key => {
      const value = $derived(props()[key])
      return () => value
    })
    $effect(() => {
      for (const read of depValues) read()
      return untrack(() => fn(service, props()))
    })
  }

  return {
    get api() {
      return api
    },
    machine: service,
  }
}
