import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  connector,
  machine,
  withAdapter,
  type Adapter,
  type Connect,
  type TransitionConfig,
} from '@render-experiment/machine-core'

/**
 * The one generic React bridge. Every component's generated api.ts calls this
 * with the agnostic pieces — a config factory, the connect, the per-target
 * adapter — plus the resolved props:
 *
 *   useMachine(tooltipMachineConfig, connectTooltip, tooltipAdapter, props)
 *
 * It: builds the machine from props (with the adapter merged in), wraps it in a
 * connector, starts on mount / stops on unmount (the connector's reactions
 * follow the machine's lifecycle automatically), keeps props fresh via setProps,
 * and drives React via useSyncExternalStore over the connector's stable
 * snapshot. Returns the connect() api + the running machine.
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
  adapter: Adapter<Context, Event, Computed>,
  props: Props,
): { api: Api; machine: ReturnType<typeof machine<State, Context, Event, Computed>> } {
  // Build machine + connector once. The first render's props seed context +
  // initial state; the adapter supplies platform effects.
  const { service, connection } = useMemo(
    () => {
      const service = machine(withAdapter(createConfig(props), adapter))
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

  // Drive re-renders off the connector's stable, memoized snapshot.
  useSyncExternalStore(
    connection.subscribe,
    () => connection.snapshot,
    () => connection.snapshot,
  )

  return { api: connection.snapshot, machine: service }
}
