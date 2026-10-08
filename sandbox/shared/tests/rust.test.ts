/**
 * The palette written in Rust (through wasm + `fromWasm`) must behave exactly like the
 * TS palette for the same event sequence — state, context, computed, and the
 * notifications. Needs the wasm build: `pnpm build:wasm`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { machine } from '@dunky.dev/state-machine'
import { commandPaletteMachineConfig, DEMO_COMMANDS, type CommandPaletteEvent } from '../src'
import { createRustDialog, createRustPalette, loadRustNode } from '../src/rust-node'

beforeAll(() => loadRustNode())

const script: CommandPaletteEvent[] = [
  { type: 'open' },
  { type: 'move', to: 'down' },
  { type: 'move', to: 'down' },
  { type: 'query.set', query: 'go' },
  { type: 'move', to: 'up' },
  { type: 'highlight', index: 99 },
  { type: 'query.set', query: 'zzz' },
  { type: 'move', to: 'down' },
  { type: 'execute' },
  { type: 'query.set', query: 'theme' },
  { type: 'move', to: 'last' },
  { type: 'execute' },
  { type: 'open' },
  { type: 'move', to: 'first' },
  { type: 'execute' },
  { type: 'close' },
]

const snapshot = (m: ReturnType<typeof createRustPalette>) => ({
  state: m.state,
  query: m.context.query,
  activeIndex: m.context.activeIndex,
  lastExecuted: m.context.lastExecuted,
  results: m.computed.results.map(c => c.id),
  activeId: m.computed.activeId,
})

describe('Rust palette', () => {
  it('matches the TS palette step by step, notification for notification', () => {
    const ts = machine(commandPaletteMachineConfig({ commands: DEMO_COMMANDS }))
    const rs = createRustPalette(DEMO_COMMANDS)
    const seen = { ts: [] as unknown[], rs: [] as unknown[] }
    ts.subscribe(() => seen.ts.push(snapshot(ts)))
    rs.subscribe(() => seen.rs.push(snapshot(rs)))
    ts.start()
    rs.start()
    for (const event of script) {
      ts.send(event)
      rs.send(event)
      expect(snapshot(rs)).toEqual(snapshot(ts))
    }
    expect(seen.rs).toEqual(seen.ts)
  })

  it('maps result indices back onto the caller’s own command objects', () => {
    const rs = createRustPalette(DEMO_COMMANDS)
    rs.send({ type: 'open' })
    expect(rs.computed.results[0]).toBe(DEMO_COMMANDS[0])
  })

  it('throws on malformed props instead of guessing', () => {
    expect(() =>
      createRustPalette([{ id: 1 } as unknown as (typeof DEMO_COMMANDS)[number]]),
    ).toThrow('[machine] bad argument: invalid type')
  })
})

describe('Rust dialog', () => {
  it('runs the `after` timer on the host clock, and cancels it when the state is left', () => {
    vi.useFakeTimers()
    try {
      const d = createRustDialog(150)
      d.start()
      d.send({ type: 'open' })
      expect(d.hasTag('visible')).toBe(true)
      d.send({ type: 'close' })
      vi.advanceTimersByTime(149)
      expect(d.state).toBe('closing')
      vi.advanceTimersByTime(1)
      expect(d.state).toBe('closed')
      expect(d.context.openCount).toBe(1)

      d.send({ type: 'open' })
      d.send({ type: 'close' })
      d.send({ type: 'open' }) // back to open before the exit delay ends
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
