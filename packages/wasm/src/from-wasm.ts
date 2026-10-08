import {
  makeBroadcast,
  makeSelection,
  type Broadcast,
  type Machine,
  type Select,
  type Selection,
} from '@dunky.dev/state-machine'

/**
 * An instance of a class exported with `dunky_wasm::export_machine!`. Calls that run
 * machine code return a status (see `OK`); the host functions run for the facade whose
 * call is in progress (`calling`).
 */
export interface WasmMachine {
  /** Connect to the host. Returns a status. */
  attach: (host: object) => number
  send: (kind: number, event: unknown) => number
  start: () => number
  stop: () => number
  running: () => boolean
  state: () => number
  field: (index: number) => unknown
  computed: (id: number) => unknown
  /** The host clock: timer `id` came due. */
  fire: (id: number) => number
  /** The binding's failure behind `ENGINE_FAILED`. */
  takeFailure: () => string | undefined
  meta: () => WasmMachineMeta
}

/** The names a Rust machine type reports, in its numbering. */
export interface WasmMachineMeta {
  states: string[]
  events: string[]
  fields: string[]
  computed: string[]
  /** Per state: its tags. */
  tags: string[][]
}

/**
 * A Rust machine's types. `pnpm build:wasm` generates them from the machine's Rust types
 * onto its exported class, as a `__types` member that exists only in the types.
 */
export interface MachineTypes {
  state: string
  context: object
  event: { type: string }
  computed: object
}

/** The types generated onto an exported class; loose ones when it has none. */
export type TypesOf<Handle> = Handle extends { readonly __types?: infer Types extends MachineTypes }
  ? Types
  : MachineTypes

/** How to produce one computed value on the JS side. */
export type ComputedMapping<Value> =
  | ((raw: unknown) => Value)
  | {
      /** Read this Rust computed value instead (e.g. indices instead of objects). */
      from: string
      map: (raw: unknown) => Value
    }

export interface FromWasmOptions<Computed> {
  /**
   * Map a raw computed value — e.g. indices that crossed the boundary, back onto the
   * host's own objects. Runs only when the value changed.
   */
  computed?: { [K in keyof Computed]?: ComputedMapping<Computed[K]> }
}

// The statuses of a call (crates/wasm/src/bridge.rs). JS owns the errors: a host
// function catches what a subscriber throws and keeps it on the machine.
const OK = 0
const FAILED = 1
const ENGINE_FAILED = 3
const NONE = Symbol('none')
const UNREAD = {}

// The facade whose call is in progress: every host function runs for it. Calls nest
// (a subscriber calls another machine), so each call saves and restores it. Keeping it
// here means no reference to the facade crosses into wasm.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let calling: RustMachine<any, any, any, any> = null!

interface Shape {
  stateNames: string[]
  tags: Array<ReadonlySet<string>>
  kinds: Map<string, number>
  fields: string[]
  computedIndex: Map<string, number>
}

// The shape is per machine TYPE: read it once per exported class, not per instance.
const shapes = new WeakMap<object, Shape>()

function shapeOf(handle: WasmMachine): Shape {
  const type = Object.getPrototypeOf(handle) as object
  let shape = shapes.get(type)
  if (!shape) {
    const meta = handle.meta()
    shape = {
      stateNames: meta.states,
      tags: meta.tags.map(tags => new Set(tags)),
      kinds: new Map(meta.events.map((name, i) => [name, i])),
      fields: meta.fields,
      computedIndex: new Map(meta.computed.map((name, i) => [name, i])),
    }
    shapes.set(type, shape)
  }
  return shape
}

type Timeout = ReturnType<typeof setTimeout>

/** The JS functions a Rust machine calls back into, for the facade of the call in
 * progress. They never throw: an error is kept on the facade, and a status returned. */
const HOST = {
  notify: (state: number, lo: number, hi: number): number => {
    const m = calling
    try {
      m.current = state
      if (lo | hi) m.refresh(lo, hi)
      m.broadcast.notify()
      return OK
    } catch (error) {
      return m.fail(error)
    }
  },
  // The pending timer holds the machine, like a JS timer holds `this`.
  startTimer: (id: number, ms: number): Timeout => {
    const m = calling
    return setTimeout(() => m.fire(id), ms)
  },
  cancelTimer: (timeout: Timeout): void => clearTimeout(timeout),
}

/**
 * The `Machine` interface over a Rust machine. Rust runs the machine: its graph, user
 * code, timers and computed values. The facade maps names to numbers, keeps a JS mirror
 * of the context (re-reading only the fields each change names), and fans each change
 * out to the subscribers.
 */
class RustMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
> implements Machine<State, Context, Event, Computed> {
  shape: Shape
  handle: WasmMachine
  ctx: Context
  computed = {} as Computed
  /** The current state's index, moved by every notify. */
  current: number
  broadcast: Broadcast = makeBroadcast()
  // Lazily created — a machine with no connector pays nothing.
  startListeners: Set<() => void> | null = null
  stopListeners: Set<() => void> | null = null
  selectFacade: Select<State, Context, Computed> | null = null
  /** The first error a subscriber threw in the current call. */
  error: unknown = NONE
  /** Nesting of calls: JS code calls back in from inside one. */
  depth = 0
  /** Started and not stopped (mirrors Rust, so JS needs no call to ask). */
  isRunning: boolean

  constructor(
    shape: Shape,
    handle: WasmMachine,
    mappings: Record<string, ComputedMapping<unknown> | undefined>,
  ) {
    this.shape = shape
    this.handle = handle
    const ctx: Record<string, unknown> = {}
    for (let i = 0; i < shape.fields.length; i++) ctx[shape.fields[i]!] = handle.field(i)
    this.ctx = ctx as Context
    this.current = handle.state()
    this.isRunning = handle.running()
    for (const [name, own] of shape.computedIndex) {
      const mapping = mappings[name]
      const map = typeof mapping === 'function' ? mapping : mapping?.map
      const source = typeof mapping === 'object' ? shape.computedIndex.get(mapping.from) : own
      if (source === undefined) {
        throw new Error(`[machine] no computed "${(mapping as { from: string }).from}"`)
      }
      // Rust serves the same JS value until it changes, so identity marks a change.
      let raw: unknown = UNREAD
      let value: unknown
      Object.defineProperty(this.computed, name, {
        enumerable: true,
        get: map
          ? () => {
              const next = handle.computed(source)
              if (next !== raw) {
                raw = next
                value = map(next)
              }
              return value
            }
          : () => handle.computed(source),
      })
    }
    this.run(() => handle.attach(HOST))
  }

  /** Run a call into Rust for this facade, and throw what failed in it. */
  run(call: () => number): void {
    const outer = calling
    calling = this
    this.depth++
    const status = call()
    this.depth--
    calling = outer
    if (status !== OK) this.raise(status)
  }
  /** Keep the first error of the call. */
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
  /** A change named context fields `lo`/`hi` (the low and high 32 bits of the mask). */
  refresh(lo: number, hi: number): void {
    const ctx = this.ctx as Record<string, unknown>
    const { fields } = this.shape
    for (let bits = lo; bits !== 0; bits &= bits - 1) {
      const i = 31 - Math.clz32(bits & -bits)
      ctx[fields[i]!] = this.handle.field(i)
    }
    for (let bits = hi; bits !== 0; bits &= bits - 1) {
      const i = 63 - Math.clz32(bits & -bits)
      ctx[fields[i]!] = this.handle.field(i)
    }
  }

  send = (event: Event): void => {
    const kind = this.shape.kinds.get(event.type)
    if (kind === undefined) return // handled nowhere: a no-op
    this.run(() => this.handle.send(kind, event))
  }
  fire(id: number): void {
    this.run(() => this.handle.fire(id))
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
    this.run(() => this.handle.start())
    if (this.startListeners) for (const fn of this.startListeners) fn()
  }
  stop = (): void => {
    if (!this.isRunning) return
    this.isRunning = false
    this.run(() => this.handle.stop())
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

/**
 * Wrap a Rust machine (an instance of a class exported with
 * `dunky_wasm::export_machine!`) in the `Machine` interface, so the connector and every
 * target consume it like a machine of the TS engine. Its types are the class's,
 * generated from the machine's Rust types.
 */
export function fromWasm<Handle extends WasmMachine>(
  handle: Handle,
  options?: FromWasmOptions<TypesOf<Handle>['computed']>,
): Machine<
  TypesOf<Handle>['state'],
  TypesOf<Handle>['context'],
  TypesOf<Handle>['event'],
  TypesOf<Handle>['computed']
>
/** For a class built without generated types: name them. */
export function fromWasm<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  handle: WasmMachine,
  options?: FromWasmOptions<Computed>,
): Machine<State, Context, Event, Computed>
export function fromWasm(
  handle: WasmMachine,
  options: FromWasmOptions<Record<string, unknown>> = {},
): Machine<string, object, { type: string }, Record<string, unknown>> {
  return new RustMachine<string, object, { type: string }, Record<string, unknown>>(
    shapeOf(handle),
    handle,
    (options.computed ?? {}) as Record<string, ComputedMapping<unknown> | undefined>,
  )
}
