/**
 * `fromWasm` against a scripted handle that plays the Rust side of the protocol:
 * events in by kind, a notify per change naming the changed fields, computed values
 * served by identity. The facade behavior both machine kinds share (subscribe, select,
 * lifecycle, timers) is pinned by the TS-machine tests.
 */
import { describe, expect, it, vi } from 'vitest'
import { fromWasm, type WasmMachine, type WasmMachineMeta } from '../src'
import type { HOST } from '../src/machine'

const FIELDS = Array.from({ length: 40 }, (_, i) => `f${i}`)

function fake() {
  let host: typeof HOST
  let me: object
  const rust = {
    state: 0,
    values: FIELDS.map(() => 0),
    computed: [[2, 0], 'other'] as unknown[],
  }
  const reads = { field: 0 }
  const handle = {
    attach: (h: object, ref: object) => {
      host = h as typeof HOST
      me = ref
      return 0
    },
    send: vi.fn((_kind: number, _event: unknown, _facade: object) => 0),
    start: () => 0,
    stop: () => 0,
    running: () => false,
    state: () => rust.state,
    computed: (id: number) => rust.computed[id],
    fire: vi.fn(() => 0),
    takeFailure: () => undefined,
    field: (i: number) => {
      reads.field++
      return rust.values[i]
    },
    meta: (): WasmMachineMeta => ({
      states: ['idle', 'busy'],
      events: ['go', 'set'],
      fields: FIELDS,
      computed: ['indices', 'other'],
      tags: [[], ['working']],
    }),
  } satisfies WasmMachine
  /** Rust changed: the state, and the fields at `changed`. */
  const change = (state: number, changed: Record<number, number>) => {
    rust.state = state
    let lo = 0
    let hi = 0
    for (const [i, value] of Object.entries(changed)) {
      rust.values[Number(i)] = value
      if (Number(i) < 32) lo |= 1 << Number(i)
      else hi |= 1 << (Number(i) - 32)
    }
    host.notify(me as never, state, lo >>> 0, hi >>> 0)
  }
  return { handle, rust, reads, change }
}

type Ctx = Record<string, number>

describe('fromWasm', () => {
  it('sends events by kind, with the event object for the payload; ignores unknown types', () => {
    const { handle } = fake()
    const m = fromWasm<'idle' | 'busy', Ctx, { type: string; v?: number }>(handle)
    m.send({ type: 'go' })
    m.send({ type: 'set', v: 1 })
    m.send({ type: 'nope' })
    expect(handle.send.mock.calls.map(([kind, event]) => [kind, event])).toEqual([
      [0, { type: 'go' }],
      [1, { type: 'set', v: 1 }],
    ])
  })

  it('moves the state on each notify and re-reads only the fields it names', () => {
    const { handle, reads, change } = fake()
    const m = fromWasm<'idle' | 'busy', Ctx, { type: 'go' }>(handle)
    const context = m.context
    const listener = vi.fn(() => [m.state, m.context.f1, m.context.f35])
    m.subscribe(listener)
    reads.field = 0
    change(1, { 1: 7, 35: 9 })
    expect(listener).toHaveReturnedWith(['busy', 7, 9])
    expect(m.hasTag('working')).toBe(true)
    expect(reads.field).toBe(2)
    expect(m.context).toBe(context)
  })

  it('maps a computed value only when Rust serves a new one; `from` reads another value', () => {
    const { handle, rust } = fake()
    const own = ['x', 'y', 'z']
    const map = vi.fn((raw: unknown) => (raw as number[]).map(i => own[i]!))
    const m = fromWasm<'idle', Ctx, { type: 'go' }, { indices: string[]; other: string[] }>(
      handle,
      { computed: { indices: map, other: { from: 'indices', map } } },
    )
    expect(m.computed.indices).toEqual(['z', 'x'])
    expect(m.computed.indices).toBe(m.computed.indices)
    expect(map).toHaveBeenCalledTimes(1)
    rust.computed[0] = [1]
    expect(m.computed.indices).toEqual(['y'])
    expect(m.computed.other).toEqual(['y'])
  })
})
