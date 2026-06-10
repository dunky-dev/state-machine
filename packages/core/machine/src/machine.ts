/**
 * Implemented as a class so the engine logic lives on the prototype (one shared
 * copy) and each instance holds only data — the per-machine footprint is flat in
 * field/state count (no per-field reactive cell, no per-instance closure tree).
 * The reactivity kernel is a tiny coarse bus: a write (context or state change)
 * bumps `version` and notifies every listener; `select` re-evaluates + value-compares
 * so it fires only on a real change (O(changed) at the listener), and `computed`
 * memoizes against `version`.
 */
import { type ActionHost, runActions } from './actions'
import { installComputed } from './computed'
import { isDev, MACHINE_INIT } from './constants'
import { makeGuardParams } from './guards'
import { lookupOn, resolve } from './transitions'
import type {
  Actions,
  GuardArg,
  Machine,
  Select,
  Selection,
  StateNode,
  Transition,
  TransitionConfig,
} from './types'

// Per-`states` tag-set cache: a state's tags depend only on the STATIC config, so
// derive them once per states-map and share across every machine built from it —
// keeps per-instance memory flat as state count grows. Keyed by the states object.
const tagsCache = new WeakMap<object, Record<string, ReadonlySet<string>>>()
function tagsForStates<State extends string>(
  states: Record<State, StateNode>,
): Record<State, ReadonlySet<string>> {
  let tags = tagsCache.get(states) as Record<State, ReadonlySet<string>> | undefined
  if (!tags) {
    tags = {} as Record<State, ReadonlySet<string>>
    for (const name in states) tags[name as State] = new Set(states[name as State].tags ?? [])
    tagsCache.set(states, tags)
  }
  return tags
}

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
  // live params + named registries that runAction(s) read (built once in the ctor)
  actionHost: ActionHost<Context, Event, Computed>

  constructor(config: TransitionConfig<State, Context, Event, Computed>) {
    this.config = config
    this.ctx = config.context // SHARED ref (copy-on-write below)
    this.stateValue = config.initial
    // shared per-config tag sets (not rebuilt per instance) — see tagsForStates
    this.tagsOf = tagsForStates(config.states)

    // Computed bag with read-key tracking — see ./computed. The host accessors
    // read this machine's live context / computed / state, so a def stays correct
    // after copy-on-write reassigns `this.ctx`. `target` IS `this.computed`, so a
    // computed→computed dep resolves in place against the same bag.
    this.computed = {} as Computed
    if (config.computed) {
      installComputed(this.computed, config.computed, {
        context: () => this.ctx,
        computed: () => this.computed,
        state: () => this.stateValue,
      })
    }

    // Live action params (context/computed re-read each run, so a later action in
    // a list sees an earlier one's writes after copy-on-write) + the named
    // registries. Built once; `runAction(s)` close over it.
    this.actionHost = {
      actions: config.implementations?.actions,
      guards: config.implementations?.guards,
      context: () => this.ctx,
      computed: () => this.computed,
      setContext: p => this.setContext(p),
      send: e => this.send(e),
    }

    this.setContext = patch => {
      // dedup: a no-op write must not notify (Object.is, early-out)
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
  // A guard resolver bound to THIS event's params + the config's guard registry,
  // handed to `resolve` (transition selection) so guard names resolve against the
  // runtime's single registry. Params are built once per event and shared across
  // the candidate list.
  private resolverFor(event: Event): (guard: GuardArg<Context, Event, Computed>) => boolean {
    const params = makeGuardParams(
      this.ctx,
      event,
      this.computed,
      this.config.implementations?.guards,
    )
    return guard => params.guard(guard)
  }
  private runActions(actions: Actions<Context, Event, Computed> | undefined, event: Event): void {
    runActions(this.actionHost, actions, event)
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
        const entry = lookupOn(this.config, this.stateValue, e.type)
        const t = resolve(entry, this.resolverFor(e))
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
    return fn(makeGuardParams(this.ctx, event, this.computed, this.config.implementations?.guards))
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
    const t = resolve(this.config.states[scheduledIn].after?.[key], this.resolverFor(event))
    if (!t) return
    this.flushing = true
    try {
      this.applyTransition(t, event)
      while (this.queue.length) {
        const e = this.queue.shift()!
        const nx = resolve(lookupOn(this.config, this.stateValue, e.type), this.resolverFor(e))
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
    // Boot the CURRENT state's effects, not the initial state's: stop() doesn't
    // reset stateValue and send() works while stopped, so a (re)start may find
    // the machine in any state (e.g. StrictMode's mount→unmount→mount).
    this.startEffects(this.stateValue, { type: MACHINE_INIT } as Event)
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
