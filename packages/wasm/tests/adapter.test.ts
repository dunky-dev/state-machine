/**
 * `fromWasm` against a scripted fake handle — the protocol edges the real machines
 * rarely hit: the shared high-field bit, timer commands, computed caching and
 * remapping, unknown events, lifecycle listeners. (The real wasm machines are covered
 * by the parity tests in packages/demo-wasm.)
 */
import { describe, expect, it, vi } from 'vitest'
import { fromWasm, type Scheduler, type WasmMachineHandle, type WasmMachineMeta } from '../src'

const FIELD = (i: number) => 1 << (2 + i)
const STATE = 1
const COMMANDS = 2

function fake(meta: Partial<WasmMachineMeta> = {}) {
  const fields = meta.fields ?? ['a', 'b']
  const state = {
    index: 0,
    values: fields.map(() => 0) as unknown[],
    version: 1,
    commands: [] as number[],
  }
  const calls = { field: 0, computed: 0, version: 0 }
  let onSend: (kind: number) => number = () => 0
  class Handle implements WasmMachineHandle {
    sendKind = vi.fn((kind: number) => onSend(kind))
    sendEvent = vi.fn((_event: unknown) => onSend(-1))
    stateIndex = () => state.index
    field = (i: number) => {
      calls.field++
      return state.values[i]
    }
    fields = () => [...state.values]
    computed = (i: number) => {
      calls.computed++
      return i === 0 ? [2, 0] : 'other'
    }
    computedVersion = () => {
      calls.version++
      return state.version
    }
    start = () => 0
    stop = () => 0
    fireTimer = vi.fn((_id: number) => 0)
    takeCommands = () => {
      const out = new Uint32Array(state.commands)
      state.commands = []
      return out
    }
    meta = (): WasmMachineMeta => ({
      states: ['idle', 'busy'],
      events: ['go', 'set'],
      unitEvents: [true, false],
      fields,
      computed: ['indices', 'other'],
      tags: [[], ['working']],
      fieldShift: 2,
      highField: 29,
      ...meta,
    })
  }
  const handle = new Handle()
  return { handle, state, calls, respond: (fn: (kind: number) => number) => (onSend = fn) }
}

function manualScheduler() {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let next = 0
  const scheduler: Scheduler = {
    setTimeout: (fn, ms) => {
      timers.set(++next, { fn, ms })
      return next
    },
    clearTimeout: handle => timers.delete(handle as number),
  }
  return { scheduler, timers }
}

describe('fromWasm', () => {
  it('sends payload-less events by kind and the rest as objects; ignores unknown types', () => {
    const { handle } = fake()
    const m = fromWasm<'idle' | 'busy', { a: number; b: number }, { type: string; v?: number }>(
      handle,
    )
    m.send({ type: 'go' })
    m.send({ type: 'set', v: 1 })
    m.send({ type: 'nope' })
    expect(handle.sendKind).toHaveBeenCalledWith(0)
    expect(handle.sendEvent).toHaveBeenCalledWith({ type: 'set', v: 1 })
    expect(handle.sendKind).toHaveBeenCalledTimes(1)
    expect(handle.sendEvent).toHaveBeenCalledTimes(1)
  })

  it('re-reads only the fields the mask names, then notifies once', () => {
    const { handle, state, calls, respond } = fake()
    const m = fromWasm<'idle' | 'busy', { a: number; b: number }, { type: 'go' }>(handle)
    const listener = vi.fn()
    m.subscribe(listener)
    respond(() => {
      state.index = 1
      state.values = [0, 7]
      return STATE | FIELD(1)
    })
    m.send({ type: 'go' })
    expect(m.state).toBe('busy')
    expect(m.hasTag('working')).toBe(true)
    expect(m.context).toEqual({ a: 0, b: 7 })
    expect(calls.field).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('treats the top bit as "every field from highField up"', () => {
    const fields = Array.from({ length: 32 }, (_, i) => `f${i}`)
    const { handle, state, respond } = fake({ fields })
    const m = fromWasm<'idle', Record<string, number>, { type: 'go' }>(handle)
    respond(() => {
      state.values = fields.map((_, i) => (i >= 29 ? i : 0))
      return FIELD(29)
    })
    m.send({ type: 'go' })
    expect([m.context.f28, m.context.f29, m.context.f30, m.context.f31]).toEqual([0, 29, 30, 31])
  })

  it('runs timer commands on the host clock and feeds fired timers back', () => {
    const { handle, state, respond } = fake()
    const { scheduler, timers } = manualScheduler()
    const m = fromWasm<'idle' | 'busy', { a: number; b: number }, { type: 'go' }>(handle, {
      scheduler,
    })
    respond(() => {
      state.commands = [1, 7, 150, 1, 8, 300]
      return COMMANDS
    })
    m.send({ type: 'go' })
    expect([...timers.values()].map(t => t.ms)).toEqual([150, 300])
    respond(() => {
      state.commands = [2, 8, 0]
      return COMMANDS
    })
    m.send({ type: 'go' })
    expect(timers.size).toBe(1)
    timers.get(1)!.fn()
    expect(handle.fireTimer).toHaveBeenCalledWith(7)
  })

  it('caches computed values until a change, and remaps a source value once per version', () => {
    const { handle, state, calls, respond } = fake()
    const own = ['x', 'y', 'z']
    const m = fromWasm<
      'idle',
      { a: number; b: number },
      { type: 'go' },
      { indices: string[]; other: string }
    >(handle, {
      computed: { indices: raw => (raw as number[]).map(i => own[i]!) },
    })
    expect(m.computed.indices).toEqual(['z', 'x'])
    expect(m.computed.indices).toBe(m.computed.indices)
    expect([calls.version, calls.computed]).toEqual([1, 1])

    respond(() => FIELD(0)) // a change, same computed version
    m.send({ type: 'go' })
    void m.computed.indices
    expect([calls.version, calls.computed]).toEqual([2, 1])

    respond(() => {
      state.version = 2
      return FIELD(0)
    })
    m.send({ type: 'go' })
    void m.computed.indices
    expect(calls.computed).toBe(2)
  })

  it('fires start listeners on start (immediately for late ones) and stop listeners on stop', () => {
    const { handle } = fake()
    const m = fromWasm<'idle', { a: number; b: number }, { type: 'go' }>(handle)
    const early = vi.fn()
    const stopped = vi.fn()
    m.onStart(early)
    m.onStop(stopped)
    m.start()
    m.start()
    const late = vi.fn()
    m.onStart(late)
    m.stop()
    expect([early.mock.calls.length, late.mock.calls.length, stopped.mock.calls.length]).toEqual([
      1, 1, 1,
    ])
  })
})
