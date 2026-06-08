/**
 * Implemented as a class so the engine logic lives on the prototype (one shared
 * copy) and each instance holds only data — the per-machine footprint is flat in
 * field/state count (no per-field reactive cell, no per-instance closure tree).
 * The reactivity kernel is a tiny coarse bus: a write (context or state change)
 * bumps `version` and notifies every listener; `select` re-evaluates + value-compares
 * so it fires only on a real change (O(changed) at the listener), and `computed`
 * memoizes against `version`.
 */
import { isOneOf } from './actions'
import { MACHINE_INIT } from './constants'
import { tagsForNodes } from './state'
import type {
  ActionArg,
  Actions,
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

class MachineClass<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
> {
  config: TransitionConfig<State, Context, Event, Computed>
  ctx: Context
  stateValue: State
  tagsOf: Record<State, ReadonlySet<string>>
  // Monotonic change counter, bumped on every notify. Lets `computed` memoize
  // (recompute only when something changed since its last read) without per-field
  // dependency tracking.
  version = 0
  // The coarse notification bus: listeners under subscribe + select. Mutated only
  // through busAdd/busDelete so `busSnapshot` (the array we iterate in bump) is
  // re-derived only when membership changes — steady-state notifies allocate
  // nothing, while still iterating a stable copy (a listener may add/remove
  // during notify; the change applies to the NEXT notify, not the current pass).
  bus = new Set<() => void>()
  busSnapshot: Array<() => void> = []
  busDirty = false
  queue: Event[] = []
  flushing = false
  running = false
  // Bumped on every state ENTRY. An `after` timer captures the generation it was
  // scheduled in; if the machine exits and re-enters the same state before a
  // deferred timer dispatches, the generation no longer matches and the stale
  // timer is ignored — closing the exit-and-re-enter TOCTOU window that a plain
  // `stateValue === scheduledIn` check would miss.
  entryCounter = 0
  stateCleanups: Array<() => void> = []
  watcherCleanups: Array<() => void> = []
  // lazily created — a machine with no reactions/connector pays nothing
  startListeners: Set<() => void> | null = null
  stopListeners: Set<() => void> | null = null
  computed: Computed
  // Copy-on-write: share the config's context object until the first write, then
  // own a private copy. An idle/never-written machine costs zero per-instance
  // context bytes beyond a shared pointer — flat memory regardless of field
  // count. `ownsCtx` flips on first setContext; the config object is never mutated.
  ownsCtx = false
  // stable bound refs handed to actions/effects (the only per-instance closures)
  setContext: (patch: Partial<Context>) => void
  send: (event: Event) => void

  constructor(config: TransitionConfig<State, Context, Event, Computed>) {
    this.config = config
    this.ctx = config.context // SHARED ref (copy-on-write below)
    this.stateValue = config.initial
    // shared per-config tag sets (not rebuilt per instance) — see tagsForNodes
    this.tagsOf = tagsForNodes(config.states as Record<State, { tags?: string[] }>)

    // Computed bag with read-key tracking: each def records exactly which
    // context keys and which other computeds it read (via a tracking proxy on
    // first/every recompute), and only recomputes when one of THOSE inputs
    // changed — not on any context write. This keeps signal-level laziness (an
    // expensive computed in a churny machine doesn't recompute when an unrelated
    // field moves) without per-field reactive cells. Chains resolve transitively
    // and glitch-free: a dep on another computed is checked by reading that
    // computed (which lazily recomputes itself first if stale).
    this.computed = {} as Computed
    // captured for the `state` getter inside each computed's params literal,
    // where `this` would otherwise bind to the literal, not the machine.
    const self = this
    if (config.computed) {
      for (const key in config.computed) {
        const k = key as keyof Computed
        const def = config.computed[k]
        let computedOnce = false
        let cachedValue: Computed[keyof Computed]
        // recorded deps from the last run: context keys + computed keys read,
        // plus whether the def read `state` (the lifecycle is also a dependency)
        let ctxDeps: string[] = []
        let computedDeps: string[] = []
        let ctxSnapshot: Record<string, unknown> = {}
        let computedSnapshot: Record<string, unknown> = {}
        let readState = false
        let stateSnapshot: State | undefined

        // The two tracking proxies are built ONCE per computed (not per recompute).
        // Their targets read `this.ctx` / `this.computed` LIVE through the trap, so
        // they stay correct even after copy-on-write reassigns `this.ctx`. Each
        // `get` records the key into the CURRENT read-set, which the recompute
        // swaps in before calling `def`.
        let ctxRead: Set<string> | null = null
        let computedRead: Set<string> | null = null
        // set true during a recompute so reading `params.state` records the
        // dependency; nulled outside so a stale-check read never records.
        let tracking = false
        const trackedCtx = new Proxy({} as Record<string, unknown>, {
          get: (_t, p: string) => {
            ctxRead?.add(p)
            return (this.ctx as Record<string, unknown>)[p]
          },
        }) as Context
        const trackedComputed = new Proxy({} as Record<string, unknown>, {
          get: (_t, p: string) => {
            computedRead?.add(p)
            return (this.computed as Record<string, unknown>)[p]
          },
        }) as Computed

        const stale = (): boolean => {
          // if the def read `state`, the lifecycle is a dependency too
          if (readState && stateSnapshot !== this.stateValue) return true
          for (const dk of ctxDeps) {
            if (!Object.is(ctxSnapshot[dk], (this.ctx as Record<string, unknown>)[dk])) return true
          }
          // reading a computed dep below resolves ITS staleness first, so a
          // transitive change surfaces as a value difference here
          for (const dk of computedDeps) {
            if (!Object.is(computedSnapshot[dk], (this.computed as Record<string, unknown>)[dk]))
              return true
          }
          return false
        }

        Object.defineProperty(this.computed, k, {
          enumerable: true,
          get: () => {
            if (computedOnce && !stale()) return cachedValue
            // swap in fresh read-sets, recompute under the (reused) proxies
            const cr = new Set<string>()
            const compr = new Set<string>()
            ctxRead = cr
            computedRead = compr
            readState = false
            tracking = true
            try {
              cachedValue = def({
                context: trackedCtx,
                computed: trackedComputed,
                // a getter: reading `state` records it as a dependency (during
                // tracking) so a later transition invalidates this computed
                get state() {
                  if (tracking) readState = true
                  return self.stateValue
                },
              }) as Computed[keyof Computed]
            } finally {
              ctxRead = null
              computedRead = null
              tracking = false
            }
            ctxDeps = [...cr]
            computedDeps = [...compr]
            stateSnapshot = readState ? this.stateValue : undefined
            ctxSnapshot = {}
            for (const dk of ctxDeps) ctxSnapshot[dk] = (this.ctx as Record<string, unknown>)[dk]
            computedSnapshot = {}
            for (const dk of computedDeps) {
              computedSnapshot[dk] = (this.computed as Record<string, unknown>)[dk]
            }
            computedOnce = true
            return cachedValue
          },
        })
      }
    }

    this.setContext = patch => {
      let changed = false
      for (const key in patch) {
        if (!Object.is(this.ctx[key], patch[key])) {
          changed = true
          break
        }
      }
      if (!changed) return
      // copy-on-first-write: stop sharing the config's object before mutating
      if (!this.ownsCtx) {
        this.ctx = { ...this.ctx } as Context
        this.ownsCtx = true
      }
      Object.assign(this.ctx, patch)
      this.bump()
    }
    this.send = event => this.doSend(event)
  }

  // ---- kernel notify ----
  // Bus membership goes through these so the iteration snapshot can be cached.
  private busAdd(listener: () => void): void {
    this.bus.add(listener)
    this.busDirty = true
  }
  private busDelete(listener: () => void): void {
    this.bus.delete(listener)
    this.busDirty = true
  }

  private bump(): void {
    this.version++
    // Iterate a STABLE snapshot, not the live Set: a listener may add/remove
    // during notify, and those changes must apply to the next notify (not be
    // visited/skipped mid-pass). The snapshot is re-derived only when membership
    // changed since the last notify, so steady-state notifies allocate nothing.
    if (this.busDirty) {
      this.busSnapshot = [...this.bus]
      this.busDirty = false
    }
    for (const l of this.busSnapshot) l()
  }

  // ---- reads ----
  get state(): State {
    return this.stateValue
  }
  get context(): Context {
    return this.ctx
  }
  hasTag = (tag: string): boolean => this.tagsOf[this.stateValue].has(tag)
  matches = (name: State): boolean => this.stateValue === name

  private setState(next: State): void {
    if (next === this.stateValue) return
    this.stateValue = next
    this.bump()
  }

  // ---- guards / resolution ----
  private guardParams(event: Event): GuardParams<Context, Event, Computed> {
    const params: GuardParams<Context, Event, Computed> = {
      context: this.ctx,
      event,
      computed: this.computed,
      guard: g => this.resolveGuard(g, params),
    }
    return params
  }
  private resolveGuard(
    guard: GuardArg<Context, Event, Computed>,
    params: GuardParams<Context, Event, Computed>,
  ): boolean {
    if (typeof guard === 'function') return guard(params)
    const fn = this.config.implementations?.guards?.[guard]
    if (!fn) {
      const msg = `[machine] no guard "${guard}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return false
    }
    return fn(params)
  }
  // Look up the `on` entry for a live event: per-state first, falling back to
  // any-state. `EventMap` is keyed to the narrow event-type literals, so the
  // entry it yields for key `K` narrows `event` to that variant at AUTHORING
  // time — but at RUNTIME we index with the broad `event.type`, so we read it
  // back through the union `TransitionEntry` (`resolve` re-narrows by matching
  // the actual event). The single place that crosses the narrow→broad boundary.
  private lookupOn(
    stateValue: State,
    type: Event['type'],
  ): TransitionEntry<State, Context, Event, Computed> | undefined {
    const onState = this.config.states[stateValue].on as
      | Record<string, TransitionEntry<State, Context, Event, Computed>>
      | undefined
    const onAny = this.config.on as
      | Record<string, TransitionEntry<State, Context, Event, Computed>>
      | undefined
    return onState?.[type] ?? onAny?.[type]
  }

  private resolve(
    entry: TransitionEntry<State, Context, Event, Computed> | undefined,
    event: Event,
  ): Transition<State, Context, Event, Computed> | undefined {
    if (!entry) return undefined
    const list = Array.isArray(entry) ? entry : [entry]
    const params = this.guardParams(event)
    // A bare fn entry is a guardless, targetless transition: normalize it to
    // { actions: [fn] } so the one "first passing guard wins" loop covers all
    // three forms. Guardless → always matches (so a bare fn is a fallback).
    for (const el of list) {
      const t: Transition<State, Context, Event, Computed> =
        typeof el === 'function' ? { actions: [el] } : el
      if (!t.guard || this.resolveGuard(t.guard, params)) return t
    }
    return undefined
  }

  // ---- actions ----
  private runAction(action: ActionArg<Context, Event, Computed>, event: Event): void {
    if (isOneOf(action)) {
      const params = this.guardParams(event)
      const branch = action.branches.find(b =>
        b.guard ? this.resolveGuard(b.guard, params) : true,
      )
      if (branch) this.runActions(branch.actions, event)
      return
    }
    // past the oneOf guard, `action` is an inline fn or a registered name
    const named = action as Exclude<typeof action, OneOf<Context, Event, Computed>>
    const fn = typeof named === 'function' ? named : this.config.implementations?.actions?.[named]
    if (!fn) {
      const msg = `[machine] no action "${action as string}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return
    }
    fn({
      context: this.ctx,
      setContext: this.setContext,
      event,
      send: this.send,
      computed: this.computed,
    })
  }
  private runActions(actions: Actions<Context, Event, Computed> | undefined, event: Event): void {
    if (!actions) return
    // An `actions` / `entry` / `exit` slot may be a single action or a list.
    const list = Array.isArray(actions) ? actions : [actions]
    for (const action of list) this.runAction(action, event)
  }

  // ---- transition: exit (cleanup effects + exit actions) → transition actions →
  // switch → entry actions + start effects. Self-transition (no state change)
  // runs actions only, skipping exit/entry. Effect boot/cleanup only while running.
  private applyTransition(t: Transition<State, Context, Event, Computed>, event: Event): void {
    const cur = this.stateValue
    const next = t.target ?? cur
    const changed = next !== cur
    if (changed) {
      if (this.running) this.stopEffects()
      this.runActions(this.config.states[cur].exit, event)
    }
    this.runActions(t.actions, event)
    if (changed) {
      this.setState(next)
      this.runActions(this.config.states[next].entry, event)
      if (this.running) this.startEffects(next, event)
    }
  }
  // Queued: a re-entrant send (from an action) waits until the current drain ends.
  private doSend(event: Event): void {
    this.queue.push(event)
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.queue.length) {
        const e = this.queue.shift()!
        const t = this.resolve(this.lookupOn(this.stateValue, e.type), e)
        if (t) this.applyTransition(t, e)
      }
    } finally {
      this.flushing = false
    }
  }

  // ---- delays / after ----
  private resolveDelay(key: string, event: Event): number {
    const asNum = Number(key)
    if (!Number.isNaN(asNum)) return asNum
    const fn = this.config.implementations?.delays?.[key]
    if (!fn) {
      const msg = `[machine] no delay "${key}"`
      if (isDev) throw new Error(msg)
      console.warn(msg)
      return 0
    }
    return fn(this.guardParams(event))
  }
  // A fired timer applies the first `after` transition whose guard passes — only
  // if still in the scheduling state and still running. If a drain is in flight,
  // defer to a microtask so it runs after the current transition completes.
  private dispatchAfter(scheduledIn: State, key: string, event: Event, generation: number): void {
    // Ignore a stale timer: not running, moved to a different state, OR exited and
    // re-entered the same state since scheduling (generation changed).
    if (!this.running || this.stateValue !== scheduledIn || this.entryCounter !== generation) {
      return
    }
    if (this.flushing) {
      queueMicrotask(() => this.dispatchAfter(scheduledIn, key, event, generation))
      return
    }
    const t = this.resolve(this.config.states[scheduledIn].after?.[key], event)
    if (!t) return
    this.flushing = true
    try {
      this.applyTransition(t, event)
      while (this.queue.length) {
        const e = this.queue.shift()!
        const nx = this.resolve(this.lookupOn(this.stateValue, e.type), e)
        if (nx) this.applyTransition(nx, e)
      }
    } finally {
      this.flushing = false
    }
  }

  // ---- effects: schedule `after` timers, then run state effects; stash cleanups ----
  private startEffects(state: State, event: Event): void {
    // Each entry is a new generation — a timer scheduled now is bound to it, so a
    // later exit+re-enter invalidates a still-pending (deferred) dispatch.
    const generation = ++this.entryCounter
    const after = this.config.states[state].after
    if (after) {
      for (const key in after) {
        const ms = this.resolveDelay(key, event)
        const id = setTimeout(() => this.dispatchAfter(state, key, event, generation), ms)
        this.stateCleanups.push(() => clearTimeout(id))
      }
    }
    const effects = this.config.states[state].effects
    if (!effects) return
    for (const effect of effects) {
      const fn =
        typeof effect === 'function' ? effect : this.config.implementations?.effects?.[effect]
      if (!fn) {
        const msg = `[machine] no effect "${effect as string}"`
        if (isDev) throw new Error(msg)
        console.warn(msg)
        continue
      }
      const cleanup = fn({
        context: this.ctx,
        setContext: this.setContext,
        event,
        send: this.send,
        computed: this.computed,
      })
      if (typeof cleanup === 'function') this.stateCleanups.push(cleanup)
    }
  }
  private stopEffects(): void {
    for (const cleanup of this.stateCleanups) cleanup()
    this.stateCleanups.length = 0
  }

  // ---- watch: machine-global data reaction. A bus listener re-reads the field
  // and runs actions on a real change (no fire on setup). Cleanups live in their
  // OWN list — watchers span the whole run, not a single state. ----
  private readField(key: string): unknown {
    return key in this.ctx
      ? (this.ctx as Record<string, unknown>)[key]
      : (this.computed as Record<string, unknown>)[key]
  }
  private startWatchers(): void {
    const watch = this.config.watch
    if (!watch) return
    for (const key in watch) {
      const actions = watch[key as keyof typeof watch]
      if (!actions) continue
      let prev = this.readField(key)
      const listener = () => {
        const next = this.readField(key)
        if (Object.is(prev, next)) return
        prev = next
        this.runActions(actions, { type: MACHINE_INIT } as Event)
      }
      this.busAdd(listener)
      this.watcherCleanups.push(() => this.busDelete(listener))
    }
  }
  private stopWatchers(): void {
    for (const dispose of this.watcherCleanups) dispose()
    this.watcherCleanups.length = 0
  }

  // ---- lifecycle: built stopped; send() works regardless of running (pure
  // state), but effects/watchers/timers run only while running. ----
  start = (): void => {
    if (this.running) return
    this.running = true
    this.startWatchers()
    this.startEffects(this.config.initial, { type: MACHINE_INIT } as Event)
    if (this.startListeners) for (const fn of this.startListeners) fn()
  }
  stop = (): void => {
    if (!this.running) return
    this.running = false
    this.stopEffects()
    this.stopWatchers()
    if (this.stopListeners) for (const fn of this.stopListeners) fn()
  }
  onStart = (fn: () => void): (() => void) => {
    ;(this.startListeners ??= new Set()).add(fn)
    if (this.running) fn() // already running → run now so a late registrant doesn't miss it
    return () => this.startListeners?.delete(fn)
  }
  onStop = (fn: () => void): (() => void) => {
    ;(this.stopListeners ??= new Set()).add(fn)
    return () => this.stopListeners?.delete(fn)
  }

  // ---- subscription: coarse (any change) ----
  subscribe = (listener: () => void): (() => void) => {
    this.busAdd(listener)
    return () => this.busDelete(listener)
  }

  // A Selection re-evaluates its selector on every bus notify and fires its
  // listener only when the selected value changes (Object.is default / equals).
  // `value` is a plain eval. No fire on subscribe.
  private makeSelection<Value>(selector: () => Value): Selection<Value> {
    const add = this.busAdd.bind(this)
    const remove = this.busDelete.bind(this)
    return {
      get value() {
        return selector()
      },
      subscribe(listener, equals = Object.is) {
        let prev = selector()
        const l = () => {
          const next = selector()
          if (equals(prev, next)) return
          prev = next
          listener(next)
        }
        add(l)
        return () => remove(l)
      },
    }
  }
  get select(): Select<State, Context, Computed> {
    const sel = (<Value>(selector: () => Value) => this.makeSelection(selector)) as Select<
      State,
      Context,
      Computed
    >
    sel.context = <K extends keyof Context>(key: K) => this.makeSelection(() => this.ctx[key])
    sel.computed = <K extends keyof Computed>(key: K) =>
      this.makeSelection(() => this.computed[key])
    sel.state = () => this.makeSelection(() => this.stateValue)
    return sel
  }
}

/**
 * Build a stopped machine service. See the file header for the architecture.
 */
export function machine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  config: TransitionConfig<State, Context, Event, Computed>,
): Machine<State, Context, Event, Computed> {
  return new MachineClass(config) as unknown as Machine<State, Context, Event, Computed>
}
