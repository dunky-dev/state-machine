/// <reference types="svelte" />
import { connector, machine, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'

/**
 * One substrate-specific effect, declared as a plain setup/teardown function
 * plus the prop names it depends on:
 *
 *   const escape: ComponentEffect<Machine, Props> = [
 *     (machine, props) => { ...addEventListener...; return () => ...remove... },
 *     ['closeOnEscape', 'onEscapeKeyDown'], // re-run when these props change
 *   ]
 *
 * The author writes no Svelte. The deps are prop NAMES (typed `(keyof Props)[]`,
 * so typos are compile errors); the bridge turns them into a tracked `$effect`
 * so the effect re-subscribes only when one of those props actually changes —
 * not on every change, never stale. `machine` is always an implicit dep.
 *
 * Identical in shape to the React `ComponentEffect` — what changes is only how
 * `useMachine` runs it (a Svelte `$effect`, not a React `useEffect`).
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * A component's full set of substrate effects — a list, since one component can
 * have several independent effects with DIFFERENT deps (e.g. an Escape listener
 * gated by `closeOnEscape` and a Tab trap gated by `focusTrap`). Each gets its
 * own `$effect` so only the one whose dep changed re-subscribes.
 *
 * Unlike React, Svelte has no rules-of-hooks: `useMachine` sets up the effects
 * once at call time, so the list need not be a module constant. Keeping it one
 * (`export const xEffects = [...]`) is still the tidy convention.
 */
export type ComponentEffects<Machine, Props> = ComponentEffect<Machine, Props>[]

type Service<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
> = ReturnType<typeof machine<State, Context, Event, Computed>>

/**
 * The one generic Svelte bridge. Every component's generated api calls this with
 * the agnostic pieces — a config factory and the connect — plus the component's
 * substrate effects and a GETTER for the resolved props:
 *
 *   const view = useMachine(tooltipMachineConfig, connectTooltip, tooltipEffects, () => props)
 *   // then in markup: <button {...normalize(view.api.triggerProps)}>
 *
 * It: builds the machine from the props' first read, wraps it in a connector,
 * starts on mount / stops on unmount (the connector's reactions follow the
 * machine's lifecycle automatically), keeps props fresh via setProps, runs the
 * component's prop-dependent effects (Escape, etc. — one `$effect` each, keyed on
 * their named prop deps), and exposes the connector's stable snapshot through a
 * `$state`-backed `api` getter so reading `view.api` in markup re-renders only on
 * a real change. Returns the connect() api + the running machine.
 *
 * The machine is built ONCE (from the first props read); later prop changes flow
 * through setProps — recreating would lose state.
 *
 * Props are passed as a GETTER (`() => props`) rather than a value: Svelte props
 * are reactive bindings, and a getter lets the bridge read their current form
 * inside its effects. This is the Svelte analogue of React's per-render `props`
 * argument; there is no `setProps` call in the component file.
 */
export function useMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Props,
  Api,
  Computed = Record<string, never>,
>(
  createConfig: (props: Props) => TransitionConfig<State, Context, Event, Computed>,
  connect: Connect<State, Context, Event, Props, Api, Computed>,
  effects: ComponentEffects<Service<State, Context, Event, Computed>, Props>,
  getProps: () => Props,
): { readonly api: Api; readonly machine: Service<State, Context, Event, Computed> } {
  // Build machine + connector once. The first props read seeds context + the
  // initial state. (Plain locals, not `$state`: their identity never changes, so
  // there's nothing to track — only the snapshot below is reactive.)
  const service = machine(createConfig(getProps()))
  const connection = connector(service, connect, getProps())

  // The reactive cell the markup reads. Seeded with the connector's initial
  // snapshot (already correct from the props above) and reassigned on every
  // connector notify; reading `view.api` therefore re-renders only on a real
  // change — the connector memoizes, so the identity is stable between changes.
  let snapshot = $state(connection.snapshot)

  // Keep consumer props fresh (controlled flags, callbacks). `getProps()` reads
  // the component's reactive props, so this effect re-runs whenever they change;
  // setProps value-dedups, so an unchanged read doesn't churn the snapshot.
  $effect(() => {
    connection.setProps(getProps())
  })

  // Lifecycle: boot on setup, tear down on destroy, and bridge the connector's
  // notifications into `snapshot`. One untracked `$effect` (it reads no reactive
  // state, so it runs once and never re-runs); Svelte calls the returned cleanup
  // on destroy. The connector wired its reactions to the machine's start/stop,
  // so start()/stop() is all the bridge needs.
  //
  // We deliberately do NOT call connection.destroy() here: the connector shares
  // this component's lifetime with the machine, so they're GC'd together, and
  // destroy() is one-way — keeping it out leaves the standalone-connector path
  // (callers who build a connector outside this pattern) free to use it.
  $effect(() => {
    const unsubscribe = connection.subscribe(() => {
      snapshot = connection.snapshot
    })
    service.start()
    return () => {
      unsubscribe()
      service.stop()
    }
  })

  // Component effects — the prop-dependent platform listeners (Escape, a
  // ResizeObserver) the machine can't own. One `$effect` per entry. Each touches
  // its named `deps` (the same allowlist React used for its manual dep array,
  // kept here for API parity) so they're the reactive reads runes tracks, then
  // runs the setup — so the effect re-runs when one of those prop values changes
  // and NOT on an unrelated machine change. Returning the setup's teardown lets
  // Svelte clean it up on re-run / destroy.
  for (const [fn, deps] of effects) {
    $effect(() => {
      const props = getProps()
      // Touch the named deps so this effect tracks exactly them. (Whether this
      // narrows tracking depends on the getter: with `() => props` over reactive
      // `$props`, each `props[key]` is a tracked read; with `() => ({ ...subset })`
      // the getter already scoped what's reactive.)
      for (const key of deps) void props[key]
      return fn(service, props)
    })
  }

  return {
    get api() {
      return snapshot
    },
    get machine() {
      return service
    },
  }
}
