import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onScopeDispose,
  onUnmounted,
  shallowRef,
  toValue,
  triggerRef,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'
import { connector, machine, type Connect, type TransitionConfig } from '@dunky.dev/state-machine'

/**
 * A substrate-specific effect: a setup/teardown function plus the prop names it depends on.
 * The tuple shape is identical across every target, so a component's effects are authored
 * once; deps are prop key names (typed, so typos compile-error) — the whole re-run contract.
 *
 *   const escape: ComponentEffect<Machine, Props> = [
 *     (machine, props) => { addEventListener(…); return () => removeEventListener(…) },
 *     ['closeOnEscape'],
 *   ]
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * The generic Vue bridge. Builds the machine once from the setup-time props, keeps props
 * fresh via setProps, runs the lifecycle and the component's effects in React's order, and
 * exposes the connector's memoized snapshot as a computed ref. Call it in setup before any
 * `await`: Vue only binds lifecycle hooks registered before the first one.
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
  // A fresh plain copy per read: a component's props proxy keeps one identity and
  // mutates in place, so setProps' shallow dedup would never see it change.
  const read = (): Props => ({ ...toValue(props) })

  const service = machine(createConfig(read()))
  const connection = connector(service, connect, read())

  // The connector memoizes its snapshot but isn't reactive: a wake only marks the computed
  // stale, and the computed re-reads the snapshot lazily — connect() runs once per read
  // after a change, not once per machine notification. Per-instance, so a server render
  // (which never disposes a scope) leaves nothing behind once the instance is collected.
  const source = shallowRef(connection)
  onScopeDispose(connection.subscribe(() => triggerRef(source)))
  const api = computed(() => source.value.snapshot)

  // Not deep: setProps compares top-level identities, so walking prop values is wasted work.
  watch(read, next => connection.setProps(next))

  // React's order: start, then the effects, after mount; teardown stops the machine, then
  // cleans the effects up once the DOM is gone, as React's passive effects do. A <KeepAlive>
  // deactivation pauses both, like React's <Activity>; onActivated also fires on the first
  // mount, hence the guard.
  let active: (() => void)[] | undefined
  const resume = () => {
    if (active) return
    try {
      service.start()
    } finally {
      // Even if a core effect threw while starting, the component's own effects still run.
      active = effects.map(([fn, deps]) => {
        // Held here, not passed to onCleanup: the instance scope stops its watchers before
        // the DOM is removed, and the cleanup must wait for that — and for stop().
        let cleanup: (() => void) | undefined
        const teardown = () => {
          const previous = cleanup
          cleanup = undefined
          previous?.()
        }
        // Each effect runs in its own watcher, so Vue reports one that throws and the rest
        // still start. One getter per dep is compared by value, so no other prop re-runs it;
        // the constant first source only keeps the array non-empty, since before Vue 3.5.36
        // an immediate watcher over an empty source never runs. `post`: a re-run sees the
        // DOM already patched with the props that caused it.
        const stop = watch(
          [() => service, ...deps.map(key => () => toValue(props)[key])],
          () => {
            teardown()
            cleanup = fn(service, toValue(props)) || undefined
          },
          { immediate: true, flush: 'post' },
        )
        return () => {
          stop()
          teardown()
        }
      })
    }
  }
  // Finishes the pass even when a cleanup throws, so one can't strand the others'
  // listeners; every failure is reported, a lone one as-is.
  const disposeEffects = () => {
    const disposers = active
    active = undefined
    if (!disposers) return
    let failures: unknown[] | undefined
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        ;(failures ??= []).push(error)
      }
    }
    if (failures) {
      throw failures.length === 1
        ? failures[0]
        : new AggregateError(failures, 'useMachine: several effect cleanups threw')
    }
  }
  onMounted(resume)
  onActivated(resume)
  onDeactivated(() => {
    try {
      service.stop()
    } finally {
      disposeEffects()
    }
  })
  // Unmounting stops the machine first and parent-first, like React's top-down passive
  // cleanups — a part's own teardown send then fires no reactions — and cleans the effects
  // up once the DOM is gone.
  onBeforeUnmount(service.stop)
  onUnmounted(disposeEffects)

  return { api, machine: service }
}
