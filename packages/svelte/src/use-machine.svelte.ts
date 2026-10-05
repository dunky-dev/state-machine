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
 * The generic Svelte bridge: builds the machine + connector once, exposes the
 * connector's snapshot as `api`, runs the lifecycle and the component's
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
  // One read of the getter per change, however many effects consume it.
  const currentProps = $derived.by(props)
  // Seed with a plain copy, never the live props proxy: setProps value-dedups,
  // and a held proxy would compare equal to itself and never wake.
  const initialProps = { ...currentProps }
  const service = machine(createConfig(initialProps))
  // Core notifies synchronously inside send(), so a send from inside an effect
  // would make that effect depend on whatever wakes on it (reactions, their
  // callbacks). Wrapped before the connector captures `service.send`.
  const send = service.send
  service.send = event => untrack(() => send(event))
  const connection = connector(service, connect, initialProps)

  // The listener only bumps a version (write-only: it must read nothing in the
  // sender's scope) and `api` pulls the connector's lazy snapshot, so connect()
  // runs once the transition settles, at most once per flush, only if read.
  let notified = 0
  let version = $state(0)
  const api = $derived.by(() => {
    void version // re-derive on every connector notify
    return untrack(() => connection.snapshot)
  })

  // Created before the template: it listens before a child's mount effect can
  // send, and its teardown stops the machine before children tear down.
  $effect.pre(() => {
    const unsubscribe = connection.subscribe(() => (version = ++notified))
    return () => {
      service.stop()
      unsubscribe()
    }
  })

  // The spread reads every prop, so any change re-runs this; setProps value-dedups.
  $effect(() => connection.setProps({ ...currentProps }))

  // No connection.destroy(): connector and machine share this component's
  // lifetime and are GC'd together; destroy() is for standalone connectors.
  $effect(() => untrack(() => service.start()))

  // One effect per entry, re-run only when a named dep's VALUE changes: a
  // $derived per dep dedups it whatever the getter reads to build the props.
  // The body runs untracked, so a prop it merely reads never becomes a dep.
  for (const [fn, deps] of effects) {
    const depValues = deps.map(key => {
      const value = $derived(currentProps[key])
      return () => value
    })
    $effect(() => {
      for (const read of depValues) read()
      return untrack(() => fn(service, currentProps))
    })
  }

  return {
    get api() {
      return api
    },
    machine: service,
  }
}
