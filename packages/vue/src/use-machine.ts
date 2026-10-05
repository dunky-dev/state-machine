import {
  computed,
  onActivated,
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
    service.start()
    const disposers: (() => void)[] = (active = [])
    runAll(
      effects.map(([fn, deps]) => () => {
        // Held here, not passed to onCleanup: the instance scope stops its watchers before
        // the DOM is removed, and the cleanup must wait for that — and for stop().
        let cleanup: (() => void) | undefined
        const teardown = () => {
          const previous = cleanup
          cleanup = undefined
          previous?.()
        }
        const run = () => {
          teardown()
          cleanup = fn(service, toValue(props)) || undefined
        }
        // One getter per dep, compared by value: no other prop re-runs the effect. `post`
        // lets a re-run see the DOM already patched with the props that caused it.
        const stop = watch(
          deps.map(key => () => toValue(props)[key]),
          run,
          { flush: 'post' },
        )
        disposers.push(() => {
          stop()
          teardown()
        })
        run()
      }),
    )
  }
  const pause = () => {
    const disposers = active ?? []
    active = undefined
    runAll([service.stop, ...disposers])
  }
  onMounted(resume)
  onActivated(resume)
  onDeactivated(pause)
  onUnmounted(pause)

  return { api, machine: service }
}

// Finish the pass even when a step throws, then rethrow the first failure — the core's own
// effect-teardown rule — so one failing effect can't strand the others.
function runAll(steps: (() => void)[]): void {
  let failed = false
  let failure: unknown
  for (const step of steps) {
    try {
      step()
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
  }
  if (failed) throw failure
}
