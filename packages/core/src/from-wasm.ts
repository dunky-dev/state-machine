import { HOST, MachineClass, type Engine, type Shape } from './machine'
import type { Machine } from './types'

/** An instance of a class exported with `dunky_wasm::export_machine!`. */
export interface WasmMachine extends Engine {
  /** Connect to the host; `facade` is the facade calling. Returns a status. */
  attach: (host: object, facade: object) => number
  field: (index: number) => unknown
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

interface RustShape extends Shape {
  fields: string[]
  computedIndex: Map<string, number>
}

// The shape is per machine TYPE: read it once per exported class, not per instance.
const shapes = new WeakMap<object, RustShape>()

function shapeOf(handle: WasmMachine): RustShape {
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

const UNREAD = {}

/** A Rust machine: the context is a mirror of the Rust one, re-read field by field. */
class RustMachine<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed,
> extends MachineClass<State, Context, Event, Computed> {
  fields: string[]
  declare handle: WasmMachine

  constructor(
    shape: RustShape,
    handle: WasmMachine,
    mappings: Record<string, ComputedMapping<unknown> | undefined>,
  ) {
    const ctx: Record<string, unknown> = {}
    for (let i = 0; i < shape.fields.length; i++) ctx[shape.fields[i]!] = handle.field(i)
    super(shape, ctx as Context, handle.state())
    this.fields = shape.fields
    this.handle = handle
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
              const next = handle.computed(source, this)
              if (next !== raw) {
                raw = next
                value = map(next)
              }
              return value
            }
          : () => handle.computed(source, this),
      })
    }
    const status = handle.attach(HOST, this)
    if (status !== 0) this.raise(status)
  }

  override refresh(lo: number, hi: number): void {
    const ctx = this.ctx as Record<string, unknown>
    for (let bits = lo; bits !== 0; bits &= bits - 1) {
      const i = 31 - Math.clz32(bits & -bits)
      ctx[this.fields[i]!] = this.handle.field(i)
    }
    for (let bits = hi; bits !== 0; bits &= bits - 1) {
      const i = 63 - Math.clz32(bits & -bits)
      ctx[this.fields[i]!] = this.handle.field(i)
    }
  }
}

/**
 * Wrap a Rust machine (an instance of a class exported with
 * `dunky_wasm::export_machine!`) in the `Machine` interface, so the connector and
 * every target consume it like a TS-authored one.
 */
export function fromWasm<
  State extends string,
  Context extends object,
  Event extends { type: string },
  Computed = Record<string, never>,
>(
  handle: WasmMachine,
  options: FromWasmOptions<Computed> = {},
): Machine<State, Context, Event, Computed> {
  return new RustMachine<State, Context, Event, Computed>(
    shapeOf(handle),
    handle,
    (options.computed ?? {}) as Record<string, ComputedMapping<unknown> | undefined>,
  )
}
