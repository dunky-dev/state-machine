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
 * One substrate-specific effect, declared as a plain setup/teardown function
 * plus the prop names it depends on:
 *
 *   const escape: ComponentEffect<Machine, Props> = [
 *     (machine, props) => { ...addEventListener...; return () => ...remove... },
 *     ['closeOnEscape', 'onEscapeKeyDown'], // re-run when these props change
 *   ]
 *
 * The author writes no Vue. The deps are prop NAMES (typed `(keyof Props)[]`,
 * so typos are compile errors); the bridge turns them into a precise Vue `watch`
 * source, so the effect re-subscribes only when one of those props actually
 * changes — not every change, never stale. The setup/teardown runs immediately
 * and re-runs (after cleanup) whenever a named dep changes. `machine` is always
 * an implicit dep.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * A component's full set of substrate effects — a list, since one component can
 * have several independent effects with DIFFERENT deps (e.g. an Escape listener
 * gated by `closeOnEscape` and a Tab trap gated by `focusTrap`). Each gets its
 * own `watch` so only the one whose dep changed re-subscribes.
 *
 * Unlike React there is no rules-of-hooks constraint — `useMachine` sets up the
 * watchers once during `setup()`, not per render — but keeping it a stable
 * module constant (`export const xEffects = [...]`) stays the convention so the
 * list reads the same across every framework binding.
 */
export type ComponentEffects<Machine, Props> = ComponentEffect<Machine, Props>[]

/**
 * The one generic Vue bridge. Every component's generated api.ts calls this
 * with the agnostic pieces — a config factory and the connect — plus the
 * component's substrate effects and the resolved props:
 *
 *   useMachine(tooltipMachineConfig, connectTooltip, tooltipEffects, props)
 *
 * It: builds the machine from props, wraps it in a connector, starts on mount /
 * stops on unmount (the connector's reactions follow the machine's lifecycle
 * automatically), keeps props fresh via setProps, runs the component's
 * prop-dependent effects (Escape, etc. — one `watch` each, keyed on their named
 * prop deps), and exposes the connector's stable snapshot as a Vue `computed`.
 * Returns the connect() api (reactive) + the running machine.
 *
 * The machine is built ONCE (from the props read at setup time); later prop
 * changes flow through setProps — recreating would lose state. Because Vue
 * `setup()` runs once, this is a plain build, not a memo.
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
  effects: ComponentEffects<ReturnType<typeof machine<State, Context, Event, Computed>>, Props>,
  props: MaybeRefOrGetter<Props>,
): { api: ComputedRef<Api>; machine: ReturnType<typeof machine<State, Context, Event, Computed>> } {
  // Resolve the reactive props input to a plain, UNWRAPPED copy on demand.
  // `props` may be a component's `props` proxy, a ref, or a getter — `toValue`
  // handles all three. The shallow copy matters: a component's `props` proxy keeps
  // a STABLE identity and mutates fields in place, so handing the live proxy to
  // connector.setProps would make its value-dedup (`Object.is` on the object) see
  // the same reference every time and skip every update. A fresh copy each read
  // lets the connector compare by FIELD value, so a real prop change propagates
  // and an equal-valued one is still deduped.
  const read = (): Props => ({ ...toValue(props) })

  // Build machine + connector once. The setup-time props seed context + initial
  // state. (Vue `setup()` runs once, so no useMemo is needed — these are plain
  // consts that live for the component's lifetime.)
  const service = machine(createConfig(read()))
  const connection = connector(service, connect, read())

  // Drive Vue reactivity off the connector's stable, memoized snapshot. The
  // connector recomputes lazily on a machine change or a props change and wakes
  // its subscribers; we mirror its current snapshot into a shallowRef and bump it
  // on every wake. Snapshot identity only changes on a real change, so reads stay
  // stable (no needless re-renders, no tearing).
  const snapshot = shallowRef(connection.snapshot)
  const off = connection.subscribe(() => {
    snapshot.value = connection.snapshot
  })
  onBeforeUnmount(off)

  // Keep consumer props fresh (controlled flags, callbacks). setProps value-dedups,
  // so an equal props object doesn't churn. `deep` because a component's `props`
  // object mutates its fields in place (stable identity, changing values).
  watch(read, next => connection.setProps(next), { deep: true })

  // Lifecycle: boot on mount, tear down on unmount. The connector wired its
  // reactions to the machine's start/stop, so start()/stop() is all the bridge
  // needs — reactions follow automatically. We deliberately do NOT call
  // connection.destroy(): the connector shares this component's lifetime with the
  // machine (both built above), so they're GC'd together. destroy() exists for
  // callers that build a connector standalone, outside this shared-lifetime pattern.
  onMounted(() => service.start())
  onBeforeUnmount(() => service.stop())

  // Component effects — the prop-dependent platform listeners (Escape, etc.) the
  // machine can't own. One `watch` per entry, sourced on its named props, so an
  // effect re-subscribes only when one of its deps actually changes. The source is
  // an ARRAY OF GETTERS (not one getter returning an array): Vue value-compares
  // each entry, and each getter touches ONLY its own prop key — so a change to a
  // NON-dep prop never re-runs the effect (a getter returning a fresh array would
  // fire on every prop change, since its identity always differs). The watcher
  // runs immediately (setup) and on each dep change re-runs after the prior
  // cleanup; the final cleanup runs on unmount via Vue's onCleanup.
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
