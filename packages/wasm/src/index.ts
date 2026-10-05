/**
 * `@dunky.dev/state-machine-wasm` — run a Rust (`dunky-core`) machine behind the
 * TypeScript `Machine` interface, so every target (react, solid, native, opentui) and
 * the connector consume it unchanged.
 *
 * The Rust side is exported with `dunky_wasm::export_machine!`. Each call returns a
 * change mask; this adapter keeps a plain JS mirror of the context and re-reads only
 * the fields the mask names, so reads stay property reads. Timers are the host's job:
 * the machine emits start/cancel commands and the adapter runs them with `setTimeout`.
 *
 * One deliberate difference from the TS engine: observers are notified ONCE per call
 * (send, start, stop, timer), after the whole run-to-completion step, instead of once
 * per change inside it.
 */
import {
  makeBroadcast,
  makeSelection,
  type Machine,
  type Select,
  type Selection,
} from '@dunky.dev/state-machine'

/** The protocol every class exported by `dunky_wasm::export_machine!` implements. */
export interface WasmMachineHandle {
  sendKind: (kind: number) => number
  sendEvent: (event: unknown) => number
  /** Fast path for events with a payload (present when the Rust event derives `deserialize`). */
  sendPayload?: (kind: number, event: unknown) => number
  stateIndex: () => number
  field: (index: number) => unknown
  fields: () => unknown[]
  computed: (index: number) => unknown
  computedVersion: (index: number) => number
  start: () => number
  stop: () => number
  fireTimer: (id: number) => number
  takeCommands: () => Uint32Array
  meta: () => WasmMachineMeta
}

/** The static description a handle reports about its machine type. */
export interface WasmMachineMeta {
  states: string[]
  events: string[]
  /** Per event type: true when the event carries no payload (sent as one number). */
  unitEvents: boolean[]
  fields: string[]
  computed: string[]
  /** Per state: its tags. */
  tags: string[][]
  fieldShift: number
  highField: number
}

/** The host clock. Defaults to the global `setTimeout` / `clearTimeout`. */
export interface Scheduler {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/** How to produce one computed value on the JS side. */
export type ComputedMapping<Value> =
  | ((raw: unknown) => Value)
  | {
      /** Read this Rust computed value instead (e.g. indices instead of objects). */
      from: string
      map: (raw: unknown) => Value
    }

export interface FromWasmOptions<Computed> {
  scheduler?: Scheduler
  /**
   * Map a raw computed value before it is cached — e.g. read indices that crossed the
   * boundary and turn them back into the host's own objects. Runs only when the value
   * changed.
   */
  computed?: { [K in keyof Computed]?: ComputedMapping<Computed[K]> }
}

const STATE_BIT = 1
const COMMANDS_BIT = 2
const OP_START = 1

interface Prepared {
  meta: WasmMachineMeta
  eventIndex: Map<string, number>
  computedIndex: Map<string, number>
}

// Meta is per machine TYPE: read it once per exported class, not per instance.
const prepared = new WeakMap<object, Prepared>()

function prepare(handle: WasmMachineHandle): Prepared {
  const type = Object.getPrototypeOf(handle) as object
  let p = prepared.get(type)
  if (!p) {
    const meta = handle.meta()
    p = {
      meta,
      eventIndex: new Map(meta.events.map((name, i) => [name, i])),
      computedIndex: new Map(meta.computed.map((name, i) => [name, i])),
    }
    prepared.set(type, p)
  }
  return p
}

const defaultScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Wrap a wasm machine handle in the `Machine` interface. */
export function fromWasm<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  handle: WasmMachineHandle,
  options: FromWasmOptions<Computed> = {},
): Machine<State, Context, Event, Computed> {
  const { meta, eventIndex, computedIndex } = prepare(handle)
  const scheduler = options.scheduler ?? defaultScheduler
  const mappings = (options.computed ?? {}) as Record<string, ComputedMapping<unknown> | undefined>
  const { states, fields, unitEvents, fieldShift, highField } = meta

  // The mirror: one plain object, identity stable, mutated in place like the TS engine's.
  const context = {} as Record<string, unknown>
  const initial = handle.fields()
  for (let i = 0; i < fields.length; i++) context[fields[i]!] = initial[i]
  let stateIdx = handle.stateIndex()
  let stateValue = states[stateIdx] as State
  let running = false

  // Computed values are cached with the Rust version stamp; `epoch` skips even the
  // version check while nothing changed since the last read.
  let epoch = 0
  const cachedValue: unknown[] = []
  const cachedVersion: number[] = []
  const cachedEpoch: number[] = []
  const computed = {} as Record<string, unknown>
  for (const [name, own] of computedIndex) {
    const mapping = mappings[name]
    const map = typeof mapping === 'function' ? mapping : mapping?.map
    const source = typeof mapping === 'object' ? computedIndex.get(mapping.from) : own
    if (source === undefined)
      throw new Error(`[machine] no computed "${(mapping as { from: string }).from}"`)
    const i = own
    cachedEpoch[i] = -1
    cachedVersion[i] = -1
    Object.defineProperty(computed, name, {
      enumerable: true,
      get() {
        if (cachedEpoch[i] === epoch) return cachedValue[i]
        cachedEpoch[i] = epoch
        const version = handle.computedVersion(source)
        if (version !== cachedVersion[i]) {
          cachedVersion[i] = version
          const raw = handle.computed(source)
          cachedValue[i] = map ? map(raw) : raw
        }
        return cachedValue[i]
      },
    })
  }

  const broadcast = makeBroadcast()
  const startListeners = new Set<() => void>()
  const stopListeners = new Set<() => void>()
  const timers = new Map<number, unknown>()

  function runCommands(): void {
    const commands = handle.takeCommands()
    for (let i = 0; i < commands.length; i += 3) {
      const id = commands[i + 1]!
      if (commands[i] === OP_START) {
        timers.set(
          id,
          scheduler.setTimeout(
            () => {
              timers.delete(id)
              apply(handle.fireTimer(id))
            },
            commands[i + 2]!,
          ),
        )
      } else {
        const t = timers.get(id)
        if (t !== undefined) scheduler.clearTimeout(t)
        timers.delete(id)
      }
    }
  }

  function apply(mask: number): void {
    if (mask === 0) return
    if (mask & STATE_BIT) {
      stateIdx = handle.stateIndex()
      stateValue = states[stateIdx] as State
    }
    let bits = mask >>> fieldShift
    let i = 0
    while (bits !== 0) {
      if (bits & 1) {
        if (i < highField) {
          context[fields[i]!] = handle.field(i)
        } else {
          // The top bit stands for every field from `highField` up.
          for (let j = highField; j < fields.length; j++) context[fields[j]!] = handle.field(j)
        }
      }
      bits >>>= 1
      i++
    }
    if (mask & COMMANDS_BIT) runCommands()
    if (mask & ~COMMANDS_BIT) {
      epoch++
      broadcast.notify()
    }
  }

  const sendPayload = handle.sendPayload?.bind(handle)
  const send = (event: Event): void => {
    const kind = eventIndex.get(event.type)
    if (kind === undefined) return // no such event type: ignored, like an unhandled event
    apply(
      unitEvents[kind]
        ? handle.sendKind(kind)
        : sendPayload
          ? sendPayload(kind, event)
          : handle.sendEvent(event),
    )
  }

  const tagSets = meta.tags.map(t => new Set(t))
  const selection = <Value>(selector: () => Value): Selection<Value> =>
    makeSelection(selector, onWake => broadcast.add(onWake))
  const select = (<Value>(selector: () => Value) => selection(selector)) as Select<
    State,
    Context,
    Computed
  >
  select.context = key => selection(() => (context as Context)[key])
  select.computed = key => selection(() => (computed as Computed)[key])
  select.state = () => selection(() => stateValue)

  return {
    get state() {
      return stateValue
    },
    get context() {
      return context as Context
    },
    get computed() {
      return computed as Computed
    },
    hasTag: tag => tagSets[stateIdx]?.has(tag) ?? false,
    matches: name => stateValue === name,
    send,
    subscribe: listener => broadcast.add(listener),
    select,
    start() {
      if (running) return
      running = true
      apply(handle.start())
      for (const fn of startListeners) fn()
    },
    stop() {
      if (!running) return
      running = false
      apply(handle.stop())
      for (const fn of stopListeners) fn()
    },
    onStart(fn) {
      startListeners.add(fn)
      if (running) fn()
      return () => startListeners.delete(fn)
    },
    onStop(fn) {
      stopListeners.add(fn)
      return () => stopListeners.delete(fn)
    },
  }
}
