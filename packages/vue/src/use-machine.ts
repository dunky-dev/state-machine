import {
  computed,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'
import { connector, machine, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'

/**
 * A substrate-specific effect: a setup/teardown function plus the prop names it depends on.
 * Deps are prop key names (typed, so typos compile-error); the bridge maps them to watch sources.
 *
 *   const escape: ComponentEffect<Machine, Props> = [
 *     (machine, props) => { addEventListener(…); return () => removeEventListener(…) },
 *     ['closeOnEscape'],
 *   ]
 *
 * One watcher runs per entry, keyed on its named deps — no rules-of-hooks here,
 * but keep the list a stable module constant so it reads the same as the other bindings.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * The generic Vue bridge. Builds the machine once from the setup-time props,
 * keeps props fresh via setProps, runs substrate effects, and drives Vue via a
 * shallowRef over the connector's snapshot.
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
  props: MaybeRefOrGetter<Props>,
): { api: ComputedRef<Api>; machine: ReturnType<typeof machine<State, Context, Event, Computed>> } {
  // A fresh unwrapped copy per read: a component's `props` proxy keeps a stable
  // identity and mutates in place, so handing it to setProps would make the
  // connector's dedup see "no change" forever.
  const read = (): Props => ({ ...toValue(props) })

  const service = machine(createConfig(read()))
  const connection = connector(service, connect, read())

  // Mirror the connector's memoized snapshot into a shallowRef on every wake —
  // identity only changes on a real change, so reads stay stable.
  const snapshot = shallowRef(connection.snapshot)
  const off = connection.subscribe(() => {
    snapshot.value = connection.snapshot
  })
  onBeforeUnmount(off)

  // `deep` because the props proxy mutates its fields in place.
  watch(read, next => connection.setProps(next), { deep: true })

  // Lifecycle: start on mount, stop on unmount. Reactions follow the machine's
  // lifecycle automatically. Not calling connection.destroy() — connector and
  // machine share the component's lifetime, so they're GC'd together.
  onMounted(() => service.start())
  onBeforeUnmount(() => service.stop())

  // One watcher per effect entry. The source is an ARRAY OF GETTERS, not one
  // getter returning an array: Vue value-compares each entry, so a change to a
  // non-dep prop never re-runs the effect (a fresh array's identity always differs).
  for (const [fn, deps] of effects) {
    watch(
      deps.map(k => () => toValue(props)[k]),
      (_next, _prev, onCleanup) => {
        const cleanup = fn(service, read())
        if (cleanup) onCleanup(cleanup)
      },
      { immediate: true },
    )
  }

  return { api: computed(() => snapshot.value), machine: service }
}
