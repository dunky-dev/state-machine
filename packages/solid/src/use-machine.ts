import { createEffect, onCleanup, onMount } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
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
 * The author writes no Solid. The deps are prop NAMES (typed `(keyof Props)[]`,
 * so typos are compile errors). The bridge runs each effect inside its own
 * `createEffect` and READS those named props there, so Solid's auto-tracking
 * re-runs the effect (cleanup → setup) only when one of those props actually
 * changes — not on unrelated changes, never stale. `machine` is a constant, so
 * it's not a dependency.
 *
 * The tuple shape is identical across every target (React, Solid, …) so a
 * component's effects are authored ONCE and run unchanged everywhere; only how
 * the bridge consumes the deps differs (a manual dep array on React, reactive
 * reads here).
 *
 * A component passes `useMachine` a plain `ComponentEffect[]` list — several
 * independent effects with DIFFERENT deps each get their own `createEffect`, so
 * only the one whose dep changed re-subscribes. Unlike React there's no
 * rules-of-hooks constraint here (a `createEffect` is not a hook), but keeping
 * the list a stable module constant (`export const xEffects = [...]`) is still
 * the convention — it reads identically across targets and never rebuilds the
 * effect closures per call.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * The one generic Solid bridge. Every component's generated api.ts calls this
 * with the agnostic pieces — a config factory and the connect — plus the
 * component's substrate effects and the (reactive) props:
 *
 *   useMachine(tooltipMachineConfig, connectTooltip, tooltipEffects, props)
 *
 * It builds the machine + connector ONCE (a Solid component body runs once, so
 * no memo is needed — the first render's props seed context + the initial
 * state), mirrors the connector's snapshot into a fine-grained `createStore`
 * (via `reconcile`, so only the leaves that actually changed notify their JSX
 * readers — the whole point of a Solid target), starts the machine on mount and
 * stops it on cleanup (the connector's reactions follow the machine's lifecycle
 * automatically), keeps props fresh via a tracked `setProps` effect, and runs
 * the component's prop-dependent effects (Escape, etc — one `createEffect` each,
 * re-running when their named prop deps change).
 *
 * Returns the connect() api (the reactive store proxy — read `api.isOpen` in
 * JSX and it updates fine-grained) and the running machine.
 *
 * Later prop changes flow through `setProps`, never a rebuild — recreating would
 * lose state.
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
  // Build machine + connector once. A Solid component body runs a single time,
  // so a plain build IS "build once" — no useMemo equivalent needed. The props
  // proxy is reactive; reading it here at build time seeds context + the initial
  // state from the first values.
  //
  // CRITICAL: seed the connector with a PLAIN snapshot (`{ ...props }`), never
  // the live Solid props proxy. The connector value-dedups in setProps
  // (shallowEqual), and if it held the proxy it would later compare the proxy
  // against a fresh spread of that same proxy — whose values have already
  // updated through the getters — find them equal, and never wake. A frozen
  // plain copy makes "did a prop change?" a real comparison.
  const service = machine(createConfig(props))
  const connection = connector(service, connect, { ...props })

  // Mirror the connector's snapshot into a fine-grained store. `reconcile`
  // deep-diffs the new snapshot against the store, so reading `api.isOpen` in
  // JSX subscribes to exactly that leaf — an unrelated field changing won't
  // touch it. This is what makes the Solid target fine-grained rather than a
  // coarse "re-render the whole component" bridge. The connector already
  // memoizes its snapshot (stable identity while clean), and `reconcile` is a
  // no-op when nothing changed, so a wake that didn't move anything is cheap.
  const [api, setApi] = createStore<Api>(connection.snapshot)
  const off = connection.subscribe(() => setApi(reconcile(connection.snapshot)))
  onCleanup(off)

  // Keep consumer props fresh (controlled flags, callbacks). `createEffect`
  // tracks every prop read inside `connection.setProps(props)` — Solid props are
  // a reactive proxy — so this re-runs whenever any consumed prop changes, with
  // no manual dep list. setProps value-dedups, so an unchanged prop set is a
  // no-op. (The connector was seeded with the initial props at build, so this
  // only pushes subsequent changes.)
  createEffect(() => connection.setProps({ ...props }))

  // Lifecycle: boot on mount, tear down on cleanup. The connector wired its
  // reactions to the machine's own start/stop, so start()/stop() is all the
  // bridge needs — reactions follow automatically.
  //
  // We deliberately do NOT call connection.destroy(): the connector shares this
  // component's lifetime with the machine (both built above), so they're GC'd
  // together. destroy() exists for callers that build a connector standalone.
  onMount(() => service.start())
  onCleanup(() => service.stop())

  // Component effects — the prop-dependent platform listeners (Escape, etc) the
  // machine can't own. One `createEffect` per entry: it READS the named prop
  // deps (so Solid re-runs it when one of them changes), runs the effect, and
  // registers the returned teardown via onCleanup (run before the next re-run
  // and on unmount). Reading the deps explicitly — rather than letting the
  // effect body's own reads decide — keeps the dependency set identical to every
  // other target, driven by the authored `deps` and nothing else.
  for (const [fn, deps] of effects) {
    createEffect(() => {
      // Touch each declared dep so this effect re-runs when it changes.
      for (const key of deps) void props[key]
      const cleanup = fn(service, props)
      if (cleanup) onCleanup(cleanup)
    })
  }

  return { api, machine: service }
}
