/**
 * Implemented as a class so the engine logic lives on the prototype (one shared
 * copy) and each instance holds only data — the per-machine footprint is flat in
 * field/state count (no per-field reactive cell, no per-instance closure tree).
 * The reactivity kernel is a tiny coarse bus: a write (context or state change)
 * bumps `version` and notifies every listener; `select` re-evaluates + value-compares
 * so it fires only on a real change (O(changed) at the listener), and `computed`
 * memoizes by snapshotting the inputs it actually read (see ./computed).
 */
import { type ActionHost, runActions } from './actions'
import { installComputed } from './computed'
import { isDev, MACHINE_INIT, MAX_DRAIN } from './constants'
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
  // nothing, while still iterating a stable copy (a listener ADDED during notify
  // first fires on the next pass; one REMOVED during notify is skipped
  // immediately — see bump).
  bus = new Set<() => void>()
  busSnapshot: Array<() => void> = []
  busDirty = false
  // The run-to-completion queue. Holds events to dispatch AND deferred jobs (a
  // watcher's action run) — both wait for the in-flight transition to finish.
  // Discriminated by typeof: an event is an object, a job is a function.
  queue: Array<Event | (() => void)> = []
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
  // stable bound refs handed to actions/effects (the only per-instance closures)
  setContext: (patch: Partial<Context>) => void
  send: (event: Event) => void
  // live params + named registries that runAction(s) read (built once in the ctor)
  actionHost: ActionHost<Context, Event, Computed>

  constructor(config: TransitionConfig<State, Context, Event, Computed>) {
    this.config = config
    // Own copy from birth, identity PERMANENT: writes mutate it in place, so a
    // reference captured anywhere (an effect's closure, action params) is a
    // live view forever; the config's object is never mutated. This replaces
    // copy-on-write — its one-time reference swap silently stranded refs
    // captured before the first write, and the sharing it bought was ~40 B per
    // idle machine on a component-sized context (see the memory bench).
    this.ctx = { ...config.context }
    this.stateValue = config.initial
    // shared per-config tag sets (not rebuilt per instance) — see tagsForStates
    this.tagsOf = tagsForStates(config.states)

    // Computed bag with read-key tracking — see ./computed. The host accessors
    // read this machine's live context / computed / state. `target` IS
    // `this.computed`, so a computed→computed dep resolves in place against the
    // same bag.
    this.computed = {} as Computed
    if (config.computed) {
      installComputed(this.computed, config.computed, {
        context: () => this.ctx,
        computed: () => this.computed,
        state: () => this.stateValue,
      })
    }

    // Live action params (context/computed re-read each run) + the named
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
      Object.assign(this.ctx, patch) // in place — this.ctx identity never changes
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
    // Iterate a STABLE snapshot, not the live Set, so a listener added during
    // notify first fires on the NEXT pass. The snapshot is re-derived only when
    // membership changed since the last notify — steady-state notifies allocate
    // nothing. The live-membership check skips listeners REMOVED mid-pass:
    // unsubscribe takes effect immediately, because firing a removed listener
    // (e.g. a reaction whose teardown just ran) breaks the unsubscribe contract.
    if (this.busDirty) {
      this.busSnapshot = [...this.bus]
      this.busDirty = false
    }
    // Until a listener (un)subscribes mid-pass, the snapshot IS live membership,
    // so the per-listener has() check is pure overhead — skip it. The instant a
    // listener mutates the bus during the pass, busAdd/busDelete flip busDirty and
    // we resume checking for the remainder (the removed-mid-pass guarantee). This
    // keeps the fan-out path (K selectors, one write) at K calls + 0 Set lookups
    // in the steady state.
    for (const l of this.busSnapshot) if (!this.busDirty || this.bus.has(l)) l()
  }

  // ---- reads ----
  get state(): State {
    return this.stateValue
  }
  get context(): Context {
    return this.ctx
  }
  hasTag(tag: string): boolean {
    return this.tagsOf[this.stateValue].has(tag)
  }
  matches(name: State): boolean {
    return this.stateValue === name
  }

  private setState(next: State): void {
    if (next === this.stateValue) return
    this.stateValue = next
    this.bump()
  }

  // ---- guards / resolution ----
  // A guard resolver bound to THIS event's params + the config's guard registry,
  // handed to `resolve` (transition selection) so guard names resolve against the
  // runtime's single registry. Params are built LAZILY: a candidate list whose
  // winner is guardless (the common UI case — `open → closed` on a click) never
  // touches a guard, so `makeGuardParams` (an object + a self-referential closure)
  // is deferred until the first guard actually runs, and memoized across the rest
  // of the list. The hottest send shape skips it entirely (see `selectTransition`).
  private resolverFor(event: Event): (guard: GuardArg<Context, Event, Computed>) => boolean {
    let params: ReturnType<typeof makeGuardParams<Context, Event, Computed>> | undefined
    return guard =>
      (params ??= makeGuardParams(
        this.ctx,
        event,
        this.computed,
        this.config.implementations?.guards,
      )).guard(guard)
  }
  // Pick the transition for an event, fast-pathing the dominant shape: a single
  // guardless `Transition` object resolves to itself with NO resolver built and
  // NO array allocated (`resolve` wraps a bare entry in a 1-element array). Only a
  // fn entry, an array (fallthrough), or a guarded object falls through to the
  // general `resolve` — which then lazily builds the resolver above.
  private selectTransition(
    entry: ReturnType<typeof lookupOn<State, Context, Event, Computed>>,
    event: Event,
  ): Transition<State, Context, Event, Computed> | undefined {
    if (entry === undefined) return undefined
    if (typeof entry === 'object' && !Array.isArray(entry) && !entry.guard) return entry
    return resolve(entry, this.resolverFor(event))
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
  // ---- queue: run-to-completion ----
  // Push an item and drain, unless a drain is already in flight — a re-entrant
  // enqueue (a send from an action, a watcher detecting a mid-transition write)
  // waits until the current transition fully finishes.
  private enqueue(item: Event | (() => void)): void {
    this.queue.push(item)
    if (this.flushing) return
    this.flushing = true
    try {
      this.drainQueue()
    } finally {
      this.flushing = false
    }
  }
  // Drain until empty, FIFO. The caller owns the `flushing` flag. An event
  // resolves + applies a transition; a job (deferred watcher run) just runs.
  private drainQueue(): void {
    let ticks = 0
    while (this.queue.length) {
      if (isDev && ++ticks > MAX_DRAIN) {
        throw new Error(
          `[machine] one drain exceeded ${MAX_DRAIN} steps — feedback loop ` +
            '(e.g. a watcher writing the field it watches, or actions sending in a cycle)',
        )
      }
      const item = this.queue.shift()!
      if (typeof item === 'function') {
        item()
        continue
      }
      const t = this.selectTransition(lookupOn(this.config, this.stateValue, item.type), item)
      if (t) this.applyTransition(t, item)
    }
  }
  private doSend(event: Event): void {
    this.enqueue(event)
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
    const t = this.selectTransition(this.config.states[scheduledIn].after?.[key], event)
    if (!t) return
    this.flushing = true
    try {
      this.applyTransition(t, event)
      this.drainQueue()
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
        // handing the object itself is safe: its identity never changes (writes
        // mutate in place), so an effect's long-lived closures read live values
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
  // and, on a real change (no fire on setup), queues the actions through the
  // run-to-completion queue — they run AFTER the transition that changed the
  // field settles, like an event sent from an action. Cleanups live in their
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
        // Defer, don't run: this listener fires inside bump() — mid-transition,
        // inside the notify pass. Running actions here would be re-entrant
        // (other listeners observe a half-applied transition; a watcher writing
        // context recurses into a nested bump, unbounded). The `running` check
        // re-runs at job time: a stop() mid-drain drops a pending watcher run.
        this.enqueue(() => {
          if (this.running) this.runActions(actions, { type: MACHINE_INIT } as Event)
        })
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
