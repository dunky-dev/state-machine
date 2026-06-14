import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { connector, machine, type Connect, type TransitionConfig } from '@chimba-ui/machine-core'

/**
 * One substrate-specific effect, declared as a plain setup/teardown function
 * plus the prop names it depends on:
 *
 *   const escape: ComponentEffect<Machine, Props> = [
 *     (machine, props) => { ...addEventListener...; return () => ...remove... },
 *     ['closeOnEscape', 'onEscapeKeyDown'], // re-run when these props change
 *   ]
 *
 * The author writes no React. The deps are prop NAMES (typed `(keyof Props)[]`,
 * so typos are compile errors); the bridge turns them into a precise React dep
 * array, so the effect re-subscribes only when one of those props actually
 * changes — not every render, never stale. `machine` is always an implicit dep.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * A component's full set of substrate effects — a list, since one component can
 * have several independent effects with DIFFERENT deps (e.g. an Escape listener
 * gated by `closeOnEscape` and a Tab trap gated by `focusTrap`). Each gets its
 * own React effect so only the one whose dep changed re-subscribes.
 *
 * MUST be a stable module constant (e.g. `export const xEffects = [...]`):
 * `useMachine` calls one `useEffect` per entry, so the list's length has to be
 * identical across renders (React's rules-of-hooks). A static export guarantees
 * that — never build this array conditionally or per-render.
 */
export type ComponentEffects<Machine, Props> = ComponentEffect<Machine, Props>[]

/**
 * The one generic React bridge. Every component's generated api.ts calls this
 * with the agnostic pieces — a config factory and the connect — plus the
 * component's substrate effects and the resolved props:
 *
 *   useMachine(tooltipMachineConfig, connectTooltip, tooltipEffects, props)
 *
 * It: builds the machine from props, wraps it in a connector, starts on mount /
 * stops on unmount (the connector's reactions follow the machine's lifecycle
 * automatically), keeps props fresh via setProps, runs the component's
 * prop-dependent effects (Escape, RN BackHandler — one `useEffect` each, keyed on
 * their named prop deps), and drives React via useSyncExternalStore over the
 * connector's stable snapshot. Returns the connect() api + the running machine.
 *
 * The machine is built ONCE (from the first render's props); later prop changes
 * flow through setProps — recreating would lose state.
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
  effects: ComponentEffects<ReturnType<typeof machine<State, Context, Event, Computed>>, Props>,
  props: Props,
): { api: Api; machine: ReturnType<typeof machine<State, Context, Event, Computed>> } {
  // Build machine + connector once. The first render's props seed context +
  // initial state.
  const { service, connection } = useMemo(
    () => {
      const service = machine(createConfig(props))
      const connection = connector(service, connect, props)
      return { service, connection }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Keep consumer props fresh (controlled flags, callbacks) — but in a PASSIVE
  // effect, never during render. setProps writes a signal the snapshot reads;
  // doing it in the render body would notify useSyncExternalStore mid-render and
  // loop ("cannot update a component while rendering"). The connector was seeded
  // with the first render's props in useMemo, so the initial snapshot is correct;
  // this only pushes subsequent changes. setProps value-dedups, so a consumer
  // that rebuilds an equal props object each render doesn't churn.
  useEffect(() => {
    connection.setProps(props)
  })

  // Lifecycle: boot on mount, tear down on unmount. The connector wired its
  // reactions to the machine's start/stop, so start()/stop() is all the bridge
  // needs — reactions follow automatically, StrictMode remount included.
  //
  // We deliberately do NOT call connection.destroy() here: the connector shares
  // this hook's lifetime with the machine (both live in the useMemo above), so
  // they're GC'd together — and destroy() is one-way, which would break the
  // StrictMode mount→unmount→mount cycle (the memo survives the remount, so a
  // destroyed connector would be reused detached). destroy() exists for callers
  // that build a connector standalone, outside this shared-lifetime pattern.
  useEffect(() => {
    service.start()
    return () => service.stop()
  }, [service])

  // Component effects — the prop-dependent platform listeners (Escape, RN
  // BackHandler) the machine can't own. One useEffect per entry, keyed on
  // [machine, ...named prop values], so an effect re-subscribes only when one of
  // its deps actually changes. Safe to loop hooks: `effects` is a stable module
  // constant (see ComponentEffects), so the count never changes between renders.
  for (const [fn, deps] of effects) {
    useEffect(
      () => fn(service, props),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [service, ...deps.map(k => props[k])],
    )
  }

  // Drive re-renders off the connector's stable, memoized snapshot.
  useSyncExternalStore(
    connection.subscribe,
    () => connection.snapshot,
    () => connection.snapshot,
  )

  return { api: connection.snapshot, machine: service }
}
