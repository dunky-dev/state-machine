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

// Tags depend only on static config — derive once per states-map, share across instances.
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
  // Monotonic counter bumped on every notify — lets computed memoize without per-field tracking.
  version = 0
  // Coarse notification bus. Mutated through busAdd/busDelete so the iteration snapshot
  // (busSnapshot) is only re-derived when membership changes — steady-state notifies allocate nothing.
  bus = new Set<() => void>()
  busSnapshot: Array<() => void> = []
  busDirty = false
  // Run-to-completion queue. Events (objects) and deferred jobs (functions) both wait for
  // the in-flight transition to finish before running.
  queue: Array<Event | (() => void)> = []
  flushing = false
  running = false
  // Bumped on every state ENTRY. An `after` timer captures the generation at schedule time;
  // if the machine exits and re-enters the same state before the timer fires, the generation
  // no longer matches and the stale timer is ignored.
  entryCounter = 0
  stateCleanups: Array<() => void> = []
  watcherCleanups: Array<() => void> = []
  // Lazily created — a machine with no connector pays nothing.
  startListeners: Set<() => void> | null = null
  stopListeners: Set<() => void> | null = null
  computed: Computed
  setContext: (patch: Partial<Context>) => void
  send: (event: Event) => void
  actionHost: ActionHost<Context, Event, Computed>

  constructor(config: TransitionConfig<State, Context, Event, Computed>) {
    this.config = config
    // Own copy from birth — identity never changes, writes mutate in place.
    // Refs captured in effects/actions always see the live context.
    this.ctx = { ...config.context }
    this.stateValue = config.initial
    this.tagsOf = tagsForStates(config.states)

    this.computed = {} as Computed
    if (config.computed) {
      installComputed(this.computed, config.computed, {
        context: () => this.ctx,
        computed: () => this.computed,
        state: () => this.stateValue,
      })
    }

    this.actionHost = {
      actions: config.implementations?.actions,
      guards: config.implementations?.guards,
      context: () => this.ctx,
      computed: () => this.computed,
      setContext: p => this.setContext(p),
      send: e => this.send(e),
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
      Object.assign(this.ctx, patch) // in place — this.ctx identity never changes
      this.bump()
    }
    this.send = event => this.doSend(event)
  }

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
    // Iterate a stable snapshot so mid-pass (un)subscribes take effect after the current pass.
    // Skip the has() guard in the steady state; flip to checked mode if membership changes mid-pass.
    if (this.busDirty) {
      this.busSnapshot = [...this.bus]
      this.busDirty = false
    }
    for (const l of this.busSnapshot) if (!this.busDirty || this.bus.has(l)) l()
  }

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

  // Guard params are built lazily — guardless transitions (the common case) never allocate them.
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
  // Fast-path: a single guardless object resolves to itself with no resolver or array allocated.
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
  // Re-entrant enqueues (send from an action, watcher mid-transition) wait for the current drain.
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
  private dispatchAfter(scheduledIn: State, key: string, event: Event, generation: number): void {
    // Stale timer: machine stopped, moved to a different state, or re-entered the same state.
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

  private startEffects(state: State, event: Event): void {
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
        // Defer: this fires inside bump() (mid-transition). Running actions immediately
        // would be re-entrant. The `running` check at job time drops pending runs on stop().
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

  start = (): void => {
    if (this.running) return
    this.running = true
    this.startWatchers()
    // Boot the CURRENT state's effects — stop() doesn't reset stateValue, so a
    // restart (e.g. StrictMode mount→unmount→mount) may be in any state.
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
    if (this.running) fn() // already running — fire immediately so late registrants don't miss it
    return () => this.startListeners?.delete(fn)
  }
  onStop = (fn: () => void): (() => void) => {
    ;(this.stopListeners ??= new Set()).add(fn)
    return () => this.stopListeners?.delete(fn)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.busAdd(listener)
    return () => this.busDelete(listener)
  }

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
