import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { connector, machine, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'

/**
 * A substrate-specific effect: a setup/teardown function plus the prop names it depends on.
 * Deps are prop key names (typed, so typos compile-error); the bridge maps them to React dep values.
 *
 *   const escape: ComponentEffect<Machine, Props> = [
 *     (machine, props) => { addEventListener(…); return () => removeEventListener(…) },
 *     ['closeOnEscape'],
 *   ]
 *
 * A component passes `useMachine` a plain `ComponentEffect[]` list, which MUST be a stable
 * module constant — one `useEffect` runs per entry, so the length must not change between renders.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * The generic React bridge. Builds the machine once from the first render's props,
 * keeps props fresh via setProps, runs substrate effects, and drives React via
 * useSyncExternalStore over the connector's snapshot.
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
  effects: ComponentEffect<ReturnType<typeof machine<State, Context, Event, Computed>>, Props>[],
  props: Props,
): { api: Api; machine: ReturnType<typeof machine<State, Context, Event, Computed>> } {
  const { service, connection } = useMemo(
    () => {
      const service = machine(createConfig(props))
      const connection = connector(service, connect, props)
      return { service, connection }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Props updates run in a passive effect — doing it during render notifies useSyncExternalStore
  // mid-render and loops. The connector was seeded at useMemo time, so the initial snapshot is correct.
  useEffect(() => {
    connection.setProps(props)
  })

  // Lifecycle: start on mount, stop on unmount. Reactions follow the machine's lifecycle automatically.
  // Not calling connection.destroy() — connector and machine share lifetime via useMemo;
  // destroy() would break StrictMode remount (memo survives, destroyed connector would be reused).
  useEffect(() => {
    service.start()
    return () => service.stop()
  }, [service])

  // One useEffect per effect entry — safe to loop because `effects` is a stable module constant.
  for (const [fn, deps] of effects) {
    useEffect(
      () => fn(service, props),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [service, ...deps.map(k => props[k])],
    )
  }

  useSyncExternalStore(
    connection.subscribe,
    () => connection.snapshot,
    () => connection.snapshot,
  )

  return { api: connection.snapshot, machine: service }
}
