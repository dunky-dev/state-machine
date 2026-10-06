import {
  computed,
  getCurrentInstance,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onScopeDispose,
  onUnmounted,
  toValue,
  watch,
  type ComponentInternalInstance,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue'
import {
  connector,
  machine,
  type Connect,
  type ConnectSnapshot,
  type Reaction,
  type TransitionConfig,
} from '@dunky.dev/state-machine'
import { createTrigger, untracked } from './tracking'

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
 * fresh via setProps, starts the machine and then the component's effects after mount, and
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
  // A fresh plain copy per read: a component's props proxy keeps one identity and mutates
  // in place, so setProps' shallow dedup would never see it change — and an effect handed
  // the live proxy would clean up with the next run's props.
  const read = (): Props => ({ ...toValue(props) })

  // Reactions call consumer code (onOpenChange…) inside send(); run untracked, they can't hand
  // their reads to a watchEffect, computed, or render that sent.
  const bridged: Connect<State, Context, Event, Props, Api, Computed> = Object.assign(
    (snapshot: ConnectSnapshot<State, Context, Event, Props, Computed>) => connect(snapshot),
    {
      reactions: connect.reactions?.map(
        ([select, react]): Reaction<State, Context, Event, Props, Computed, unknown> => [
          select,
          (value, current) => untracked(() => react(value, current)),
        ],
      ),
    },
  )
  const service = machine(createConfig(read()))
  const connection = connector(service, bridged, read())

  // The connector memoizes its snapshot but isn't reactive: a wake only marks the computed
  // stale, and the computed re-reads the snapshot lazily — connect() runs once per read after
  // a change, never in the middle of a transition. destroy() also unhooks the reactions, so a
  // machine kept past unmount and restarted can't call back into a component that is gone;
  // <KeepAlive> never disposes the scope.
  const { track, trigger } = createTrigger()
  connection.subscribe(trigger)
  onScopeDispose(() => connection.destroy())
  const api = computed(() => {
    track()
    return connection.snapshot
  })

  // Not deep: setProps compares top-level identities, so walking prop values is wasted work.
  watch(read, next => connection.setProps(next))

  // After mount: start, then the effects, as React orders them. A <KeepAlive> deactivation
  // pauses both, like React's <Activity>; onActivated also fires on the first mount, hence the
  // guard.
  let active: (() => void)[] | undefined
  const resume = () => {
    if (active) return
    const disposers: (() => void)[] = (active = [])
    settle([
      service.start,
      ...effects.map(([fn, deps]) => () => {
        // Held here, not passed to onCleanup: the instance scope stops its watchers before the
        // DOM is removed, and the cleanup must wait for that — and for stop().
        let cleanup: (() => void) | undefined
        const teardown = () => {
          const previous = cleanup
          cleanup = undefined
          previous?.()
        }
        // Each run gets its own snapshot of the props, so its cleanup undoes exactly what it
        // set up, as with React's render props; a cleanup that throws can't block the setup.
        const run = () => {
          try {
            teardown()
          } finally {
            cleanup = fn(service, read()) || undefined
          }
        }
        // One getter per dep, compared by value: no other prop re-runs the effect. `post`
        // lets a re-run see the DOM already patched with the props that caused it.
        const stop = watch(
          deps.map(key => () => toValue(props)[key]),
          run,
          { flush: 'post' },
        )
        // Recorded before the first run, so an effect that throws still gets torn down.
        disposers.push(() => {
          stop()
          teardown()
        })
        run()
      }),
    ])
  }
  const takeDisposers = (): (() => void)[] => {
    const disposers = active ?? []
    active = undefined
    return disposers
  }
  // Mounted into a <KeepAlive> view that is already deactivated — a part added while its
  // cached view is hidden — hold still: Vue fires onMounted there, then onActivated when the
  // view comes back.
  const instance = getCurrentInstance()
  onMounted(() => {
    if (!inDeactivatedView(instance)) resume()
  })
  onActivated(resume)
  onDeactivated(() => settle([service.stop, ...takeDisposers()]))
  // Unmounting stops the machine before the component's children unmount, so a part's own
  // teardown send fires no reactions; the effect cleanups follow in onUnmounted, after the DOM
  // has been patched away.
  onBeforeUnmount(service.stop)
  onUnmounted(() => settle(takeDisposers()))

  return { api, machine: service }
}

// The ancestor walk Vue's own activation hooks make: only a view's root is flagged.
function inDeactivatedView(instance: ComponentInternalInstance | null): boolean {
  for (let current = instance; current; current = current.parent) {
    if (current.isDeactivated) return true
  }
  return false
}

// Runs every step even when one throws, so one failing effect or cleanup can't strand the
// others; then reports every failure — a lone one as-is.
function settle(steps: (() => void)[]): void {
  let failures: unknown[] | undefined
  for (const step of steps) {
    try {
      step()
    } catch (error) {
      ;(failures ??= []).push(error)
    }
  }
  if (failures) {
    throw failures.length === 1
      ? failures[0]
      : new AggregateError(failures, 'useMachine: several lifecycle steps threw')
  }
}
