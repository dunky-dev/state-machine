import { computed as preactComputed, effect as preactEffect } from '@preact/signals-core'
import { MACHINE_INIT } from './constants'
import { createContext } from './context'
import { createState } from './state'
import type {
  ActionArg,
  GuardArg,
  GuardParams,
  Machine,
  OneOf,
  Select,
  Selection,
  Transition,
  TransitionConfig,
  TransitionEntry,
} from './types'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * The single public factory. `machine(config)` builds a stopped service that
 * composes every concern — context, state, queued transitions, guards, actions,
 * effects, computed, the subscription surface — into one running instance. It is
 * BUILT but not running: `.start()` boots its effects, `.stop()` runs their
 * cleanups. Reads are tracked getters; observe via subscribe/select.
 *
 * The runtime is one closure on purpose: guards, actions, effects, computed,
 * transitions, watchers, and timers share mutable state (the event queue, the
 * `running` flag, the active-cleanup lists) and can't be split into modules
 * without threading that state around. The pure, standalone pieces (context,
 * state, guard combinators, oneOf, withAdapter, config, connector) live in their
 * own files; this file assembles them.
 */
export function machine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  config: TransitionConfig<State, Context, Event, Computed>,
): Machine<State, Context, Event, Computed> {
  const st = createState<State>(config.initial, config.states)
  const { context, setContext } = createContext<Context>(config.context)

  // Build the `computed` bag. Each def becomes a lazy, memoized preact
  // computed() that auto-subscribes to whatever it reads and recomputes only
  // when a read context cell (or other computed) changes. The bag is the SAME
  // reference passed into every def, so a def reading `computed.other` chains
  // correctly; the engine threads this bag into guard/action/effect params and
  // surfaces it on the machine.
  const computed = {} as Computed
  if (config.computed) {
    for (const key in config.computed) {
      const k = key as keyof Computed
      const def = config.computed[k]
      const sig = preactComputed(() => def({ context, computed }))
      Object.defineProperty(computed, k, {
        get: () => sig.value,
        enumerable: true,
        configurable: false,
      })
    }
  }

  // Resolve a guard arg (inline fn or registered name) against params. Single
  // channel so the combinators reuse it. Missing name → throw in dev, warn +
  // false in prod.
  const guardRegistry = config.implementations?.guards
  const resolveGuard = (
    guard: GuardArg<Context, Event, Computed>,
    params: GuardParams<Context, Event, Computed>,
  ): boolean => {
    if (typeof guard === 'function') return guard(params)
    const fn = guardRegistry?.[guard]
    if (!fn) {
      const msg = `[machine] no guard "${guard}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return false
    }
    return fn(params)
  }

  // Build the params a guard receives for this event. `guard` lets a guard (or
  // a combinator) resolve another guard against these same params.
  const guardParams = (event: Event): GuardParams<Context, Event, Computed> => {
    const params: GuardParams<Context, Event, Computed> = {
      context,
      event,
      computed,
      guard: g => resolveGuard(g, params),
    }
    return params
  }

  // Resolve an entry (single or array) to the first transition whose guard
  // passes. No guard = always passes.
  const resolve = (
    entry: TransitionEntry<State, Context, Event, Computed> | undefined,
    event: Event,
  ) => {
    if (!entry) return undefined
    const list = Array.isArray(entry) ? entry : [entry]
    const params = guardParams(event)
    return list.find(t => (t.guard ? resolveGuard(t.guard, params) : true))
  }

  // The event queue. send() enqueues; the first send drains the queue, so a
  // re-entrant send (from an action) waits until the current transition ends.
  const queue: Event[] = []
  let draining = false

  // Resolve and run an action arg — inline fn, registered name, or a oneOf(...)
  // conditional branch. Missing name → throw in dev, warn in prod.
  const actionRegistry = config.implementations?.actions
  const isOneOf = (a: unknown): a is OneOf<Context, Event, Computed> =>
    typeof a === 'object' && a !== null && (a as { __oneOf?: boolean }).__oneOf === true
  const runAction = (action: ActionArg<Context, Event, Computed>, event: Event) => {
    if (isOneOf(action)) {
      const params = guardParams(event)
      const branch = action.branches.find(b => (b.guard ? resolveGuard(b.guard, params) : true))
      if (branch) runActions(branch.actions, event)
      return
    }
    const fn = typeof action === 'function' ? action : actionRegistry?.[action]
    if (!fn) {
      const msg = `[machine] no action "${action as string}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return
    }
    fn({ context, setContext, event, send, computed })
  }

  const runActions = (
    actions: Array<ActionArg<Context, Event, Computed>> | undefined,
    event: Event,
  ) => {
    if (!actions) return
    for (const action of actions) runAction(action, event)
  }

  // Apply one already-resolved transition: exit (cleanup effects + exit
  // actions) → transition actions → switch → entry actions + start effects.
  // Shared by event-driven (send) and delay-driven (after) transitions. An
  // internal self-transition (no state change) runs actions only, skipping
  // exit/entry. Effect boot/cleanup happens only while running; a stopped
  // machine still transitions and runs entry/exit actions, just no effects.
  const applyTransition = (t: Transition<State, Context, Event, Computed>, event: Event) => {
    const cur = st.state
    const next = t.target ?? cur
    const changed = next !== cur
    if (changed) {
      if (running) stopEffects(cur)
      runExit(cur, event)
    }
    runActions(t.actions, event)
    if (changed) {
      st.set(next)
      runEntry(next, event)
      if (running) startEffects(next, event) // also (re)schedules `after` timers
    }
  }

  const send = (event: Event) => {
    queue.push(event)
    if (draining) return
    draining = true
    try {
      while (queue.length) {
        const e = queue.shift()!
        // Per-state `on` first, then top-level `on`.
        const entry = config.states[st.state].on?.[e.type] ?? config.on?.[e.type]
        const t = resolve(entry, e)
        if (t) applyTransition(t, e)
      }
    } finally {
      draining = false
    }
  }

  // entry/exit action lists, run by applyTransition around the switch.
  const runEntry = (state: State, event: Event) => runActions(config.states[state].entry, event)
  const runExit = (state: State, event: Event) => runActions(config.states[state].exit, event)

  // Resolve an `after` delay key → ms. A numeric key ("200") is its own value;
  // otherwise it's a name looked up in implementations.delays (which may read
  // context/computed, so a prop-driven delay is dynamic). Missing → dev throw.
  const effectRegistry = config.implementations?.effects
  const activeCleanups: Array<() => void> = []
  const delayRegistry = config.implementations?.delays
  const resolveDelay = (key: string, event: Event): number => {
    const asNum = Number(key)
    if (!Number.isNaN(asNum)) return asNum
    const fn = delayRegistry?.[key]
    if (!fn) {
      const msg = `[machine] no delay "${key}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return 0
    }
    return fn(guardParams(event))
  }

  // A fired timer applies the first `after` transition whose guard passes — but
  // only if still in the scheduling state (a late timer after a re-entry is
  // ignored) and still running. If a send() drain is in flight (a timer fired
  // mid-transition), defer to a microtask so it runs after the drain completes,
  // preserving run-to-completion without dropping the transition.
  const dispatchAfter = (scheduledIn: State, key: string, event: Event) => {
    if (!running || st.state !== scheduledIn) return
    if (draining) {
      queueMicrotask(() => dispatchAfter(scheduledIn, key, event))
      return
    }
    const t = resolve(config.states[scheduledIn].after?.[key], event)
    if (!t) return
    draining = true
    try {
      applyTransition(t, event)
      while (queue.length) {
        const e = queue.shift()!
        const next = resolve(config.states[st.state].on?.[e.type] ?? config.on?.[e.type], e)
        if (next) applyTransition(next, e)
      }
    } finally {
      draining = false
    }
  }

  // Start a state's resources on enter: schedule its `after` timers, then run
  // its effects and stash any returned cleanups. Both timers and effects are
  // state-scoped, so a timer's clearTimeout joins activeCleanups and is cleared
  // on exit alongside effect cleanups.
  const startEffects = (state: State, event: Event) => {
    const after = config.states[state].after
    if (after) {
      for (const key in after) {
        const ms = resolveDelay(key, event)
        const id = setTimeout(() => dispatchAfter(state, key, event), ms)
        activeCleanups.push(() => clearTimeout(id))
      }
    }
    const effects = config.states[state].effects
    if (!effects) return
    for (const effect of effects) {
      const fn = typeof effect === 'function' ? effect : effectRegistry?.[effect]
      if (!fn) {
        const msg = `[machine] no effect "${effect as string}"`
        if (isDev) throw new Error(msg)
        console.warn(msg)
        continue
      }
      const cleanup = fn({ context, setContext, event, send, computed })
      if (typeof cleanup === 'function') activeCleanups.push(cleanup)
    }
  }
  const stopEffects = (_state: State) => {
    for (const cleanup of activeCleanups) cleanup()
    activeCleanups.length = 0
  }

  // Watchers — machine-global data-reactions. Each watched field becomes a
  // preact effect that reads that field (context or computed) and runs its
  // actions on change, skipping the priming run (no fire on setup). Their
  // cleanups live in their OWN list (not activeCleanups) because watchers span
  // the whole run (start→stop), not a single state — stopEffects clears
  // activeCleanups on every state exit, which must not tear watchers down.
  const watchConfig = config.watch
  const watcherCleanups: Array<() => void> = []
  const readField = (key: string): unknown =>
    key in context
      ? (context as Record<string, unknown>)[key]
      : (computed as Record<string, unknown>)[key]
  const startWatchers = () => {
    if (!watchConfig) return
    for (const key in watchConfig) {
      const actions = watchConfig[key as keyof typeof watchConfig]
      if (!actions) continue
      let primed = false
      const dispose = preactEffect(() => {
        readField(key) // tracked read → re-runs when this field changes
        if (!primed) {
          primed = true
          return
        }
        runActions(actions, { type: MACHINE_INIT } as Event)
      })
      watcherCleanups.push(dispose)
    }
  }
  const stopWatchers = () => {
    for (const dispose of watcherCleanups) dispose()
    watcherCleanups.length = 0
  }

  // The machine is built STOPPED — no effects run until start(). send() works
  // regardless of `running` (transitions are pure state); effects, watchers, and
  // timers only run while running, so a stopped machine mutates state without
  // side-effects.
  let running = false
  const start = () => {
    if (running) return
    running = true
    startWatchers()
    startEffects(config.initial, { type: MACHINE_INIT } as Event)
  }
  const stop = () => {
    if (!running) return
    running = false
    stopEffects(st.state)
    stopWatchers() // watchers span the whole run — torn down here, not on exit
  }

  // Coarse subscribe: one preact effect reads the state + every context cell, so
  // any state transition or context write re-runs it. (Computed changes are
  // downstream of context, so we needn't read computeds here — and reading them
  // would force the lazy ones.) The effect body runs once on creation to
  // register deps; `primed` skips that first run so the listener fires only on
  // subsequent changes. Returns a bare unsubscribe; costs nothing unless called.
  const subscribe = (listener: () => void): (() => void) => {
    let primed = false
    return preactEffect(() => {
      void st.state
      for (const key in context) void context[key as keyof Context]
      if (primed) listener()
      else primed = true
    })
  }

  // Build a Selection from a preact computed signal. `value` is a tracked read.
  // `subscribe` runs an effect reading the signal, compares to the previous
  // selected value (Object.is default / `equals`), and fires only on a real
  // change — skipping the priming run.
  const makeSelection = <Value>(sig: { value: Value }): Selection<Value> => ({
    get value() {
      return sig.value
    },
    subscribe(listener, equals = Object.is) {
      let prev: Value
      let primed = false
      return preactEffect(() => {
        const next = sig.value // tracks exactly what the selector read
        if (!primed) {
          prev = next
          primed = true
          return
        }
        if (equals(prev, next)) return // selected value unchanged → no fire
        prev = next
        listener(next)
      })
    },
  })

  // Function-form selector wraps the selector in a lazy/memoized preact computed
  // so it auto-tracks exactly what it reads. The typed named-scope sugar
  // (context/computed/state) builds the same Selection over one named field —
  // exact return types, autocomplete, and compile-time typo safety on the key.
  const select = (<Value>(selector: () => Value): Selection<Value> =>
    makeSelection(preactComputed(selector))) as Select<State, Context, Computed>
  select.context = <K extends keyof Context>(key: K) =>
    makeSelection(preactComputed(() => context[key]))
  select.computed = <K extends keyof Computed>(key: K) =>
    makeSelection(preactComputed(() => computed[key]))
  select.state = () => makeSelection(preactComputed(() => st.state))

  return {
    get state() {
      return st.state
    },
    hasTag: st.hasTag,
    matches: st.matches,
    get context() {
      return context
    },
    get computed() {
      return computed
    },
    send,
    subscribe,
    select,
    start,
    stop,
  }
}
