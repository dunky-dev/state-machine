import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onScopeDispose,
  shallowRef,
  toValue,
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

  // The connector memoizes its snapshot but isn't reactive, so its wakes are counted and
  // the computed re-reads it lazily: connect() runs once per read after a change, not once
  // per machine notification. Per-instance, so a server render — which never disposes a
  // scope — leaves nothing behind once the instance is collected.
  const wakes = shallowRef(0)
  onScopeDispose(connection.subscribe(() => wakes.value++))
  const api = computed(() => {
    void wakes.value
    return connection.snapshot
  })

  // Not deep: setProps compares top-level identities, so walking prop values is wasted work.
  watch(read, next => connection.setProps(next))

  // React's order: start, then the effects, all after mount; teardown stops the machine,
  // then cleans the effects up. A <KeepAlive> deactivation pauses both, as React's
  // <Activity> does; onActivated also fires on the first mount, hence the guard.
  let stopEffects: (() => void)[] | undefined
  const resume = () => {
    if (stopEffects) return
    service.start()
    stopEffects = effects.map(([fn, deps]) => {
      // The first run is direct, not `immediate`: before Vue 3.5.x an immediate watcher
      // over an empty source never fires.
      let cleanup = fn(service, toValue(props)) || undefined
      // An array of getters is compared dep by dep, so no other prop can trigger a re-run;
      // `post` lets the re-run see the DOM already patched with the props that caused it.
      const stop = watch(
        deps.map(key => () => toValue(props)[key]),
        () => {
          cleanup?.()
          cleanup = fn(service, toValue(props)) || undefined
        },
        { flush: 'post' },
      )
      return () => {
        stop()
        cleanup?.()
      }
    })
  }
  const pause = () => {
    service.stop()
    if (stopEffects) for (const stop of stopEffects) stop()
    stopEffects = undefined
  }
  onMounted(resume)
  onActivated(resume)
  onDeactivated(pause)
  onBeforeUnmount(pause)

  return { api, machine: service }
}
