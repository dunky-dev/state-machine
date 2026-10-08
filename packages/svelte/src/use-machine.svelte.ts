import { untrack } from 'svelte'
import {
  connector,
  machine,
  type Connect,
  type Reaction,
  type TransitionConfig,
} from '@dunky.dev/state-machine'

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

// `$derived` dedups with ===; mapping NaN and -0 to their own keys gives deps
// React's Object.is semantics.
const NAN = Symbol('NaN')
const NEGATIVE_ZERO = Symbol('-0')
const asDep = (value: unknown): unknown =>
  Number.isNaN(value) ? NAN : Object.is(value, -0) ? NEGATIVE_ZERO : value

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
  const initialProps = untrack(() => ({ ...currentProps }))
  const service = machine(createConfig(initialProps))

  // Core notifies synchronously, so whatever wakes on a notification would run
  // in the tracking scope of the effect that caused it. Reactions are the
  // consumer's code on that path (their callbacks are props): untracked here,
  // whatever notified — a send, a context change, a timer.
  type MachineReaction = Reaction<State, Context, Event, Props, Computed, unknown>
  const untrackedConnect = Object.assign(
    (snapshot: Parameters<typeof connect>[0]) => connect(snapshot),
    {
      reactions: connect.reactions?.map(
        ([select, callback]): MachineReaction => [
          m => untrack(() => select(m)),
          (value, props) => untrack(() => callback(value, props)),
        ],
      ),
    },
  )

  // A read of `api` from inside a send (a reaction callback, a selector) runs
  // after setState but before the entry actions, so it gets the last settled
  // snapshot instead of connect() over a half-applied transition; and the
  // version bump waits for the outermost send to end, so whatever was re-read
  // mid-send is invalidated afterwards. Sends also run untracked (guards,
  // actions, the consumer's own listeners). Not covered: transitions that don't
  // start at this send — an `after` timer, an action's own async send, a
  // watcher fed by a core effect's setContext — or a send issued inside one;
  // that needs a "settled" hook in core. Wrapped before the connector captures
  // `service.send`.
  let sending = 0
  let changed = false // notified since `settled` was taken
  let deferred = false // notified during the send in flight
  let notified = 0
  let version = $state(0)
  const send = service.send
  service.send = event => {
    // Two sends in one tick: reads in the second see what the first settled to.
    if (sending++ === 0 && changed) {
      changed = false
      settled = untrack(() => connection.snapshot)
    }
    try {
      untrack(() => send(event))
    } finally {
      // Untracked like the listener's own bump, which runs inside the send.
      if (--sending === 0 && deferred) {
        deferred = false
        untrack(() => (version = ++notified))
      }
    }
  }
  const connection = connector(service, untrackedConnect, initialProps)
  let settled = untrack(() => connection.snapshot)

  // Created before the template: it listens before a child's mount effect can
  // send, and its teardown stops the machine before children tear down. The
  // listener only writes: it must read nothing in the notifier's scope.
  $effect.pre(() => {
    const unsubscribe = connection.subscribe(() => {
      changed = true
      if (sending) deferred = true
      else version = ++notified
    })
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
      const value = $derived(asDep(currentProps[key]))
      return () => value
    })
    $effect(() => {
      for (const read of depValues) read()
      return untrack(() => fn(service, currentProps))
    })
  }

  return {
    get api() {
      void version // re-read on every connector notify
      if (sending) return settled
      changed = false
      return (settled = untrack(() => connection.snapshot))
    },
    machine: service,
  }
}
