import { makeBroadcast, type Broadcast } from './broadcast'
import { compile, fieldBit, type Compiled } from './compile'
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
 * implement it. Calls that run machine code return a status (see `OK`).
 */
export interface Engine {
  // `facade` is the facade calling: the host functions of that call receive it.
  send: (kind: number, event: unknown, facade: object) => number
  start: (facade: object) => number
  stop: (facade: object) => number
  running: () => boolean
  state: () => number
  computed: (id: number, facade: object) => unknown
  /** The host clock: timer `id` came due. */
  fire: (id: number, facade: object) => number
  /** The engine's failure behind `ENGINE_FAILED`. */
  takeFailure: () => string | undefined
}

// The statuses of an engine call (crates/wasm/src/bridge.rs). JS owns the errors: a
// host function catches what user code throws and keeps it on the machine.
const OK = 0
const FAILED = 1
const ENGINE_FAILED = 3
const NONE = Symbol('none')

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
  /** Bumped on every change (a context write, a state change): a computed value read at
   * the same epoch is still valid. */
  epoch = 0
  /** Nesting of engine calls: JS code calls back in from inside one. */
  depth = 0

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
    this.epoch++
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
    this.depth++
    const status = this.handle.send(kind, event, this)
    this.depth--
    if (status !== OK) this.raise(status)
  }
  fire(id: number): void {
    this.depth++
    const status = this.handle.fire(id, this)
    this.depth--
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
    if (this.handle.running()) return
    this.depth++
    const status = this.handle.start(this)
    this.depth--
    if (status !== OK) this.raise(status)
    if (this.startListeners) for (const fn of this.startListeners) fn()
  }
  stop = (): void => {
    if (!this.handle.running()) return
    this.depth++
    const status = this.handle.stop(this)
    this.depth--
    if (status !== OK) this.raise(status)
    if (this.stopListeners) for (const fn of this.stopListeners) fn()
  }
  onStart = (fn: () => void): (() => void) => {
    ;(this.startListeners ??= new Set()).add(fn)
    if (this.handle.running()) fn() // already running — fire immediately so late registrants don't miss it
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
  cleanups: Map<number, () => void> | null = null
  nextCleanup = 1
  /** Per computed value: the epoch it was last read at, and the value. */
  readAt: number[]
  readValue: unknown[]
  tracked: { context: Context; computed: Computed; readonly state: State } | null = null

  constructor(c: Compiled, context: Context) {
    // Own copy from birth — identity never changes, writes mutate in place.
    // Refs captured in effects/actions always see the live context.
    super(c, { ...context }, c.initial)
    this.c = c
    this.readAt = c.computedDefs.map(() => -1)
    this.readValue = c.computedDefs.map(() => undefined)
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
      if (changed) {
        this.epoch++
        this.broadcast.notify()
      }
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
    this.epoch++
    this.depth++
    const status = this.handle.markChanged(lo >>> 0, hi >>> 0, this)
    this.depth--
    if (status !== OK) this.raise(status)
    this.broadcast.notify()
  }

  /** Read computed `id`; throw if its definition failed during this read. */
  read(id: number): unknown {
    // Every input of a TS machine changes through JS, so an unchanged epoch means an
    // unchanged value: no call into the engine.
    if (this.readAt[id] === this.epoch) return this.readValue[id]
    const before = this.error
    this.depth++
    const value = this.handle.computed(id, this)
    this.depth--
    if (this.error !== before) this.raise(FAILED)
    this.readAt[id] = this.epoch
    this.readValue[id] = value
    return value
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

  /** Run computed `id`; report its value and what it read to Rust, which owns its staleness. */
  evaluate(id: number): number {
    const lo = readLo
    const hi = readHi
    const state = readsState
    const outer = reads
    readLo = 0
    readHi = 0
    readsState = false
    reads = null
    try {
      const value = this.c.computedDefs[id]!(this.trackedParams())
      this.handle.report(
        value,
        readLo >>> 0,
        readHi >>> 0,
        readsState,
        reads ? Uint32Array.from(reads) : undefined,
      )
      return OK
    } finally {
      readLo = lo
      readHi = hi
      readsState = state
      reads = outer
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
type Facade = MachineClass<string, object, { type: string }, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TsFacade = TsMachine<string, object, { type: string }, any>
type Timeout = ReturnType<typeof setTimeout>

/** The JS functions the engine calls back into (see crates/wasm/src/bridge.rs). They
 * never throw: each catches what user code throws, keeps it on the machine, and returns
 * a failure status. */
interface Host {
  /** 0 false, 1 true, 2 failed. */
  guard: (m: TsFacade, fn: number, event: unknown) => number
  /** `notify`: a state change to announce first (it rides on this call), or -1. */
  action: (m: TsFacade, fn: number, event: unknown, notify: number) => number
  /** The cleanup's id, 0 for no cleanup, -1 failed. */
  effect: (m: TsFacade, fn: number, event: unknown, notify: number) => number
  cleanup: (m: TsFacade, id: number) => number
  /** The delay in ms, -1 failed. */
  delay: (m: TsFacade, fn: number, event: unknown) => number
  computed: (m: TsFacade, id: number) => number
  /** The first candidate of guard list `list` that passes, -1 for none, -2 failed. */
  pick: (m: TsFacade, list: number, event: unknown) => number
  actions: (m: TsFacade, list: number, event: unknown, notify: number) => number
  notify: (m: Facade, state: number, lo: number, hi: number) => number
  startTimer: (m: Facade, id: number, ms: number) => Timeout
  cancelTimer: (timeout: Timeout) => void
}

/**
 * The host functions Rust calls, with the facade of the call in progress and, for user
 * code, the callback's index in the compiled tables.
 */
export const HOST: Host = {
  guard: (m, fn, event) => {
    try {
      return m.c.guards[fn]!(m.guardParams(event)) ? 1 : 0
    } catch (error) {
      m.fail(error)
      return 2
    }
  },
  action: (m, fn, event, notify) => {
    try {
      if (notify >= 0) m.enter(notify)
      m.c.actions[fn]!(m.actionParams(event))
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  effect: (m, fn, event, notify) => {
    try {
      if (notify >= 0) m.enter(notify)
      const cleanup = m.c.effects[fn]!(m.actionParams(event))
      if (typeof cleanup !== 'function') return 0
      ;(m.cleanups ??= new Map()).set(m.nextCleanup, cleanup)
      return m.nextCleanup++
    } catch (error) {
      m.fail(error)
      return -1
    }
  },
  cleanup: (m, id) => {
    const cleanup = m.cleanups!.get(id)!
    m.cleanups!.delete(id)
    try {
      cleanup()
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  delay: (m, fn, event) => {
    try {
      const ms = m.c.delays[fn]!(m.guardParams(event))
      return ms > 0 ? ms : 0 // like setTimeout: negative or NaN means now
    } catch (error) {
      m.fail(error)
      return -1
    }
  },
  computed: (m, id) => {
    try {
      return m.evaluate(id)
    } catch (error) {
      return m.fail(error)
    }
  },
  pick: (m, list, event) => {
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
  actions: (m, list, event, notify) => {
    try {
      if (notify >= 0) m.enter(notify)
      const actions = m.c.actionLists[list]!
      const params = m.actionParams(event)
      for (let i = 0; i < actions.length; i++) m.c.actions[actions[i]!]!(params)
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  notify: (m, state, lo, hi) => {
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
  startTimer: (m, id, ms) => setTimeout(() => m.fire(id), ms),
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
