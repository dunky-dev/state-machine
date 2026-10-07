import { makeBroadcast, type Broadcast } from './broadcast'
import { compile, fieldBit, type ActionSpec, type Compiled } from './compile'
import { MACHINE_INIT } from './constants'
import { makeGuardParams } from './guards'
import { makeSelection } from './selection'
import { JsMachine } from './wasm'
import type {
  ActionParams,
  GuardParams,
  Machine,
  Select,
  Selection,
  TransitionConfig,
} from './types'

/**
 * What the facade drives: a machine on the Rust engine. `JsMachine` (a TS-authored
 * machine) and every class exported with `dunky_wasm::export_machine!` (a Rust machine)
 * implement it. Calls that run machine code return a status (see `OK`); the host
 * functions run for the facade whose call is in progress (`calling`).
 */
export interface Engine {
  send: (kind: number, event: unknown) => number
  start: () => number
  stop: () => number
  running: () => boolean
  state: () => number
  /** The host clock: timer `id` came due. */
  fire: (id: number) => number
  /** The engine's failure behind `ENGINE_FAILED`. */
  takeFailure: () => string | undefined
}

// The statuses of an engine call (crates/wasm/src/bridge.rs). JS owns the errors: a
// host function catches what user code throws and keeps it on the machine.
const OK = 0
const FAILED = 1
const ENGINE_FAILED = 3
/** The host's `computed` status bit: the value changed. */
const CHANGED = 2
const NONE = Symbol('none')

// The facade whose engine call is in progress: every host function runs for it. Calls
// nest (user code calls another machine), so each call saves and restores it. Keeping it
// here means no reference to the facade crosses into wasm.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFacade = MachineClass<any, any, any, any>
let calling: AnyFacade = null!

/** The names the facade maps the engine's numbers onto. */
export interface Shape {
  stateNames: string[]
  tags: Array<ReadonlySet<string>>
  kinds: Map<string, number>
}

// One shared instance — the boot event carries no payload, so nothing needs a fresh object.
const INIT_EVENT = Object.freeze({ type: MACHINE_INIT })

/**
 * The `Machine` interface over the Rust engine. Rust owns the graph: the queue,
 * transition resolution, entry/exit order, the effects lifecycle, `after` timers,
 * watchers and computed bookkeeping. The facade maps names to numbers, keeps the
 * context object and fans each change out to the subscribers.
 */
export class MachineClass<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
> implements Machine<State, Context, Event, Computed> {
  shape: Shape
  handle!: Engine
  ctx: Context
  computed = {} as Computed
  /** The current state's index, moved by every notify. */
  current: number
  broadcast: Broadcast = makeBroadcast()
  // Lazily created — a machine with no connector pays nothing.
  startListeners: Set<() => void> | null = null
  stopListeners: Set<() => void> | null = null
  selectFacade: Select<State, Context, Computed> | null = null
  /** The first error user code threw in the current call. */
  error: unknown = NONE
  /** Nesting of engine calls: JS code calls back in from inside one. */
  depth = 0
  /** Started and not stopped (mirrors the engine, so JS needs no call to ask). */
  isRunning = false

  constructor(shape: Shape, context: Context, current: number) {
    this.shape = shape
    this.ctx = context
    this.current = current
  }

  /** A change named context fields `lo`/`hi` (the low and high 32 bits of the mask). */
  refresh(_lo: number, _hi: number): void {}

  /** The machine is in `state` now: tell the subscribers. */
  enter(state: number): void {
    this.current = state
    this.broadcast.notify()
  }

  /** Keep the first error of the call; the status tells the engine to stop the step. */
  fail(error: unknown): number {
    if (this.error === NONE) this.error = error
    return FAILED
  }
  /** Throw what failed: the outermost call takes the error, a nested one leaves it. */
  raise(status: number): never {
    if (status === ENGINE_FAILED) throw new Error(this.handle.takeFailure())
    const error = this.error
    if (this.depth === 0) this.error = NONE
    throw error
  }

  send = (event: Event): void => {
    const kind = this.shape.kinds.get(event.type)
    if (kind === undefined) return // handled nowhere: a no-op
    const outer = calling
    calling = this
    this.depth++
    const status = this.handle.send(kind, event)
    this.depth--
    calling = outer
    if (status !== OK) this.raise(status)
  }
  fire(id: number): void {
    const outer = calling
    calling = this
    this.depth++
    const status = this.handle.fire(id)
    this.depth--
    calling = outer
    if (status !== OK) this.raise(status)
  }

  get state(): State {
    return this.shape.stateNames[this.current] as State
  }
  get context(): Context {
    return this.ctx
  }
  hasTag(tag: string): boolean {
    return this.shape.tags[this.current]!.has(tag)
  }
  matches(name: State): boolean {
    return this.shape.stateNames[this.current] === name
  }

  start = (): void => {
    if (this.isRunning) return
    this.isRunning = true
    const outer = calling
    calling = this
    this.depth++
    const status = this.handle.start()
    this.depth--
    calling = outer
    if (status !== OK) this.raise(status)
    if (this.startListeners) for (const fn of this.startListeners) fn()
  }
  stop = (): void => {
    if (!this.isRunning) return
    this.isRunning = false
    const outer = calling
    calling = this
    this.depth++
    const status = this.handle.stop()
    this.depth--
    calling = outer
    if (status !== OK) this.raise(status)
    if (this.stopListeners) for (const fn of this.stopListeners) fn()
  }
  onStart = (fn: () => void): (() => void) => {
    ;(this.startListeners ??= new Set()).add(fn)
    if (this.isRunning) fn() // already running — fire immediately so late registrants don't miss it
    return () => this.startListeners?.delete(fn)
  }
  onStop = (fn: () => void): (() => void) => {
    ;(this.stopListeners ??= new Set()).add(fn)
    return () => this.stopListeners?.delete(fn)
  }

  subscribe = (listener: () => void): (() => void) => this.broadcast.add(listener)

  private makeSelection<Value>(selector: () => Value): Selection<Value> {
    return makeSelection(selector, onWake => this.broadcast.add(onWake))
  }
  // Built on first access, then reused — the facade is stateless, so one instance serves all reads.
  get select(): Select<State, Context, Computed> {
    if (this.selectFacade) return this.selectFacade
    const sel = (<Value>(selector: () => Value) => this.makeSelection(selector)) as Select<
      State,
      Context,
      Computed
    >
    sel.context = <K extends keyof Context>(key: K) => this.makeSelection(() => this.ctx[key])
    sel.computed = <K extends keyof Computed>(key: K) =>
      this.makeSelection(() => this.computed[key])
    sel.state = () => this.makeSelection(() => this.state)
    return (this.selectFacade = sel)
  }
}

// What the computed evaluation in progress read. Evaluations nest (a computed value
// reading another), so each one saves and restores the frame around it.
let readLo = 0
let readHi = 0
let readsState = false
let reads: number[] | null = null

function markRead(bit: number): void {
  if (bit < 32) readLo |= 1 << bit
  else readHi |= 1 << (bit - 32)
}

/** What JS keeps of one computed value of a TS machine. */
interface CacheEntry {
  value: unknown
  /** No input changed since the value was evaluated or checked. */
  valid: boolean
  /** What the last evaluation read: fields (the low and high 32 bits of the mask), the
   * state, other computed values. */
  lo: number
  hi: number
  state: boolean
  computed: number[] | null
  /** The computed values that read this one. */
  readers: number[] | null
  /** Rust has the reads (false until the first evaluation). */
  reported: boolean
  /** The last clearing pass that reached this entry. */
  pass: number
}

function newEntry(): CacheEntry {
  return {
    value: undefined,
    valid: false,
    lo: 0,
    hi: 0,
    state: false,
    computed: null,
    readers: null,
    reported: false,
    pass: 0,
  }
}

let clearPass = 0

// Walk past an entry that is already cleared: Rust may have checked its readers since
// (an input changed but kept its value), so they can be valid.
function clearEntry(cache: CacheEntry[], entry: CacheEntry, pass: number): void {
  if (entry.pass === pass) return
  entry.pass = pass
  entry.valid = false
  const readers = entry.readers
  if (readers) for (let i = 0; i < readers.length; i++) clearEntry(cache, cache[readers[i]!]!, pass)
}

function sameIds(a: number[] | null, b: number[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// The params of the dispatch in progress: its guards and actions share them. One slot
// for all machines, so no machine keeps a dispatch's params alive.
let paramsOf: object | null = null
let paramsEvent: unknown = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actionParams: ActionParams<any, any, any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let guardParams: GuardParams<any, any, any> | null = null

function reuse(machine: object, event: unknown): void {
  paramsOf = machine
  paramsEvent = event
  actionParams = null
  guardParams = null
}

/**
 * A TS-authored machine. Rust calls back (the host functions below) to run its user
 * code; the context is a plain JS object, mutated in place, and JS reports each write's
 * change mask so Rust can drive the watchers and computed staleness.
 */
class TsMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
> extends MachineClass<State, Context, Event, Computed> {
  c: Compiled
  declare handle: JsMachine
  /** The cleanups of the effects started in the current state, in start order. */
  effectCleanups: Array<() => void> = []
  /** Per computed value, its cached value and inputs; null without computed values. */
  cache: CacheEntry[] | null
  tracked: { context: Context; computed: Computed; readonly state: State } | null = null

  constructor(c: Compiled, context: Context) {
    // Own copy from birth — identity never changes, writes mutate in place.
    // Refs captured in effects/actions always see the live context.
    super(c, { ...context }, c.initial)
    this.c = c
    this.cache = c.computedDefs.length === 0 ? null : c.computedDefs.map(newEntry)
    for (const [name, id] of c.computedIndex) {
      Object.defineProperty(this.computed, name, { enumerable: true, get: () => this.read(id) })
    }
    // Rust holds the facade only during a call: only JS references (a consumer, an
    // effect's `send`, a pending timer) keep the machine alive, as with any JS object.
    this.handle = new JsMachine(c.rust, HOST)
  }

  setContext = (patch: Partial<Context>): void => {
    const ctx = this.ctx as Record<string, unknown>
    // Only watchers and computed values need the engine to hear about a write.
    if (!this.c.tracksContext) {
      let changed = false
      for (const key in patch) {
        const value = (patch as Record<string, unknown>)[key]
        if (Object.is(ctx[key], value)) continue
        ctx[key] = value // in place — ctx identity never changes
        changed = true
      }
      if (changed) this.broadcast.notify()
      return
    }
    let lo = 0
    let hi = 0
    for (const key in patch) {
      const value = (patch as Record<string, unknown>)[key]
      if (Object.is(ctx[key], value)) continue
      ctx[key] = value
      const bit = fieldBit(this.c.fieldBits, key)
      if (bit < 32) lo |= 1 << bit
      else hi |= 1 << (bit - 32)
    }
    if ((lo | hi) === 0) return
    const read = this.cache !== null && this.clear(lo, hi, false)
    if (this.c.watches) {
      const outer = calling
      calling = this
      this.depth++
      const status = this.handle.markChanged(lo >>> 0, hi >>> 0)
      this.depth--
      calling = outer
      if (status !== OK) this.raise(status)
    } else if (read) {
      // The engine's stamps only matter for fields a computed value read.
      this.handle.stamp(lo >>> 0, hi >>> 0)
    }
    this.broadcast.notify()
  }

  override enter(state: number): void {
    if (this.cache) this.clear(0, 0, true)
    super.enter(state)
  }

  /** Clear the cached values that read a field of `lo`/`hi` (or the state, with
   * `state`), and the values that read a cleared one. True when one read them. */
  clear(lo: number, hi: number, state: boolean): boolean {
    const cache = this.cache!
    const pass = ++clearPass
    let read = false
    for (let i = 0; i < cache.length; i++) {
      const entry = cache[i]!
      if ((entry.lo & lo) !== 0 || (entry.hi & hi) !== 0 || (state && entry.state)) {
        read = true
        clearEntry(cache, entry, pass)
      }
    }
    return read
  }

  /** Read computed `id`; throw if its definition failed during this read. */
  read(id: number): unknown {
    // Every input of a TS machine changes through JS, so a valid entry is the value.
    const entry = this.cache![id]!
    if (entry.valid) return entry.value
    const outer = calling
    calling = this
    this.depth++
    const status = this.handle.computed(id)
    this.depth--
    calling = outer
    if (status !== OK) this.raise(status)
    entry.valid = true
    return entry.value
  }

  /** Run compiled action specs in order: callbacks, runs of callbacks, `oneOf`s. */
  runSpecs(
    specs: ActionSpec[],
    params: ActionParams<Context, Event, Computed>,
    event: unknown,
  ): void {
    const { actions } = this.c
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!
      if (spec.id !== undefined) actions[spec.id]!(params)
      else if (spec.list !== undefined) {
        const list = this.c.actionLists[spec.list]!
        for (let j = 0; j < list.length; j++) actions[list[j]!]!(params)
      } else if (spec.oneOf) {
        const guards = this.guardParams(event)
        for (const branch of spec.oneOf) {
          if (branch.guard === undefined || this.c.guards[branch.guard]!(guards)) {
            this.runSpecs(branch.actions, params, event)
            break
          }
        }
      }
    }
  }

  /** What the engine held back to ride on this call: bit 0 stops the effects, the bits
   * above hold a state change (the state + 1). */
  prelude(pre: number): void {
    if (pre & 1) this.stopEffects()
    const state = (pre >>> 1) - 1
    if (state >= 0) this.enter(state)
  }
  /** Run every cleanup, in start order, even past one that throws; then throw the first. */
  stopEffects(): void {
    const cleanups = this.effectCleanups
    if (cleanups.length === 0) return
    this.effectCleanups = []
    let failed = false
    let first: unknown
    for (let i = 0; i < cleanups.length; i++) {
      try {
        cleanups[i]!()
      } catch (error) {
        if (!failed) {
          failed = true
          first = error
        }
      }
    }
    if (failed) throw first
  }

  actionParams(event: unknown): ActionParams<Context, Event, Computed> {
    const e = event ?? INIT_EVENT
    if (paramsOf !== this || paramsEvent !== e) reuse(this, e)
    return (actionParams ??= {
      context: this.ctx,
      setContext: this.setContext,
      event: e,
      send: this.send,
      computed: this.computed,
    }) as ActionParams<Context, Event, Computed>
  }
  guardParams(event: unknown): GuardParams<Context, Event, Computed> {
    const e = event ?? INIT_EVENT
    if (paramsOf !== this || paramsEvent !== e) reuse(this, e)
    return (guardParams ??= makeGuardParams(
      this.ctx,
      e,
      this.computed,
      this.c.guardRegistry,
    )) as GuardParams<Context, Event, Computed>
  }

  /** Run computed `id` for the engine, which owns its staleness. The value stays here;
   * the status says whether it changed, and what it read crosses only when it differs
   * from the previous evaluation. */
  evaluate(id: number): number {
    const entry = this.cache![id]!
    const lo = readLo
    const hi = readHi
    const state = readsState
    const outer = reads
    readLo = 0
    readHi = 0
    readsState = false
    reads = null
    entry.valid = false
    try {
      const value = this.c.computedDefs[id]!(this.trackedParams())
      const changed = !Object.is(entry.value, value)
      entry.value = value
      entry.valid = true
      const sameComputed = sameIds(reads, entry.computed)
      if (
        !entry.reported ||
        !sameComputed ||
        readLo !== entry.lo ||
        readHi !== entry.hi ||
        readsState !== entry.state
      ) {
        entry.reported = true
        entry.lo = readLo
        entry.hi = readHi
        entry.state = readsState
        if (!sameComputed) {
          entry.computed = reads
          this.linkReaders()
        }
        this.handle.report(
          readLo >>> 0,
          readHi >>> 0,
          readsState,
          reads ? Uint32Array.from(reads) : undefined,
        )
      }
      return changed ? CHANGED : OK
    } finally {
      readLo = lo
      readHi = hi
      readsState = state
      reads = outer
    }
  }
  /** Rebuild who reads whom, after an evaluation read other computed values. */
  linkReaders(): void {
    const cache = this.cache!
    for (let i = 0; i < cache.length; i++) cache[i]!.readers = null
    for (let i = 0; i < cache.length; i++) {
      const read = cache[i]!.computed
      if (read) for (let j = 0; j < read.length; j++) (cache[read[j]!]!.readers ??= []).push(i)
    }
  }
  trackedParams(): { context: Context; computed: Computed; readonly state: State } {
    if (this.tracked) return this.tracked
    const { c, handle } = this
    const machine = this
    const context = new Proxy(this.ctx, {
      get(target, key) {
        if (typeof key === 'string') markRead(fieldBit(c.fieldBits, key))
        return Reflect.get(target, key)
      },
    })
    const computed = new Proxy(this.computed as object, {
      get(target, key) {
        const id = typeof key === 'string' ? c.computedIndex.get(key) : undefined
        if (id === undefined) return Reflect.get(target, key)
        reads ??= []
        if (!reads.includes(id)) reads.push(id)
        return machine.read(id)
      },
    }) as Computed
    return (this.tracked = {
      context,
      computed,
      get state() {
        readsState = true
        // Read live: a computed value can run mid-transition, before the notify that
        // moves `current`.
        return c.stateNames[handle.state()] as State
      },
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TsFacade = TsMachine<string, object, { type: string }, any>
type Timeout = ReturnType<typeof setTimeout>

/** The JS functions the engine calls back into (see crates/wasm/src/bridge.rs), for the
 * facade whose call is in progress (`calling`). They never throw: each catches what user
 * code throws, keeps it on the machine, and returns a failure status. */
interface Host {
  /** 0 false, 1 true, 2 failed. */
  guard: (fn: number, event: unknown) => number
  /** `pre`: what rides on this call, delivered first (see `prelude`), or 0. */
  action: (fn: number, event: unknown, pre: number) => number
  /** Start an effect; its cleanup waits in `effectCleanups`. */
  effect: (fn: number, event: unknown, pre: number) => number
  /** Deliver `pre` on its own. */
  pre: (pre: number) => number
  /** The delay in ms, -1 failed. */
  delay: (fn: number, event: unknown) => number
  /** 0, `CHANGED` when the value changed (it stays in JS), 1 failed. */
  computed: (id: number) => number
  /** The first candidate of guard list `list` that passes, -1 for none, -2 failed. */
  pick: (list: number, event: unknown) => number
  actions: (list: number, event: unknown, pre: number) => number
  /** Run transition `id` whole (`flags`: 1 stops the effects, 2 starts the target's).
   * 0 done, 1 failed before the switch, 2 after it, 3 while starting the effects. */
  transition: (
    id: number,
    from: number,
    to: number,
    event: unknown,
    flags: number,
    pre: number,
  ) => number
  notify: (state: number, lo: number, hi: number) => number
  startTimer: (id: number, ms: number) => Timeout
  cancelTimer: (timeout: Timeout) => void
}

/** Run `call` as an engine call of `facade`, so the host functions run for it. */
export function callFor(facade: AnyFacade, call: () => number): number {
  const outer = calling
  calling = facade
  facade.depth++
  const status = call()
  facade.depth--
  calling = outer
  return status
}

/** The host functions Rust calls; user code by its index in the compiled tables. */
export const HOST: Host = {
  guard: (fn, event) => {
    const m = calling as TsFacade
    try {
      return m.c.guards[fn]!(m.guardParams(event)) ? 1 : 0
    } catch (error) {
      m.fail(error)
      return 2
    }
  },
  action: (fn, event, pre) => {
    const m = calling as TsFacade
    try {
      if (pre) m.prelude(pre)
      m.c.actions[fn]!(m.actionParams(event))
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  effect: (fn, event, pre) => {
    const m = calling as TsFacade
    try {
      if (pre) m.prelude(pre)
      const cleanup = m.c.effects[fn]!(m.actionParams(event))
      if (typeof cleanup === 'function') m.effectCleanups.push(cleanup)
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  pre: pre => {
    const m = calling as TsFacade
    try {
      m.prelude(pre)
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  delay: (fn, event) => {
    const m = calling as TsFacade
    try {
      const ms = m.c.delays[fn]!(m.guardParams(event))
      return ms > 0 ? ms : 0 // like setTimeout: negative or NaN means now
    } catch (error) {
      m.fail(error)
      return -1
    }
  },
  computed: id => {
    const m = calling as TsFacade
    try {
      return m.evaluate(id)
    } catch (error) {
      return m.fail(error)
    }
  },
  pick: (list, event) => {
    const m = calling as TsFacade
    try {
      const candidates = m.c.guardLists[list]!
      const params = m.guardParams(event)
      for (let i = 0; i < candidates.length; i++) {
        const guard = candidates[i]!
        if (guard < 0 || m.c.guards[guard]!(params)) return i
      }
      return -1
    } catch (error) {
      m.fail(error)
      return -2
    }
  },
  actions: (list, event, pre) => {
    const m = calling as TsFacade
    try {
      if (pre) m.prelude(pre)
      const actions = m.c.actionLists[list]!
      const params = m.actionParams(event)
      for (let i = 0; i < actions.length; i++) m.c.actions[actions[i]!]!(params)
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  transition: (id, from, to, event, flags, pre) => {
    const m = calling as TsFacade
    let phase = 1
    try {
      if (pre) m.prelude(pre)
      if (flags & 1) m.stopEffects()
      const params = m.actionParams(event)
      m.runSpecs(m.c.exitActions[from]!, params, event)
      m.runSpecs(m.c.transitionActions[id]!, params, event)
      phase = 2
      m.enter(to)
      m.runSpecs(m.c.entryActions[to]!, params, event)
      // An action may have stopped the machine mid-transition.
      if (flags & 2 && m.isRunning) {
        phase = 3
        const effects = m.c.stateEffects[to]!
        for (let i = 0; i < effects.length; i++) {
          const cleanup = m.c.effects[effects[i]!]!(params)
          if (typeof cleanup === 'function') m.effectCleanups.push(cleanup)
        }
      }
      return OK
    } catch (error) {
      m.fail(error)
      return phase
    }
  },
  notify: (state, lo, hi) => {
    const m = calling
    try {
      if (lo | hi) {
        m.current = state
        m.refresh(lo, hi)
        m.broadcast.notify()
      } else m.enter(state)
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  // The pending timer holds the machine, like a JS timer holds `this`.
  startTimer: (id, ms) => {
    const m = calling
    return setTimeout(() => m.fire(id), ms)
  },
  cancelTimer: timeout => clearTimeout(timeout),
}

/**
 * What a bridge can build a service from: a config (run by this engine) or a ready
 * machine — e.g. a Rust machine wrapped with `fromWasm`.
 */
export type MachineSource<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
> = TransitionConfig<State, Context, Event, Computed> | Machine<State, Context, Event, Computed>

/** Build a stopped service from a config; a ready machine is returned as is. */
export function toMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  source: MachineSource<State, Context, Event, Computed>,
): Machine<State, Context, Event, Computed> {
  return typeof (source as Machine<State, Context, Event, Computed>).send === 'function'
    ? (source as Machine<State, Context, Event, Computed>)
    : machine(source as TransitionConfig<State, Context, Event, Computed>)
}

export function machine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  config: TransitionConfig<State, Context, Event, Computed>,
): Machine<State, Context, Event, Computed> {
  return new TsMachine<State, Context, Event, Computed>(compile(config), config.context)
}
