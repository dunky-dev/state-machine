/**
 * Parity: the Rust palette (through wasm + the adapter) must behave exactly like the TS
 * palette in sandbox/shared for the same event sequence — state, context and computed.
 * Needs the wasm build: `pnpm build:wasm`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { machine } from '@dunky.dev/state-machine'
import {
  commandPaletteMachineConfig,
  DEMO_COMMANDS,
  type CommandPaletteEvent,
} from '@sandbox/cmdk-core'
import { createDialog, createPalette, createPaletteObjects, loadDemoNode } from '../src/node'

beforeAll(() => loadDemoNode())

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

const snapshot = (m: ReturnType<typeof createPalette>) => ({
  state: m.state,
  query: m.context.query,
  activeIndex: m.context.activeIndex,
  lastExecuted: m.context.lastExecuted,
  results: m.computed.results.map(c => c.id),
  activeId: m.computed.activeId,
})

describe('wasm palette', () => {
  it('matches the TS palette step by step', () => {
    const ts = machine(commandPaletteMachineConfig({ commands: DEMO_COMMANDS }))
    const rs = createPalette(DEMO_COMMANDS)
    ts.start()
    rs.start()
    for (const event of script) {
      ts.send(event)
      rs.send(event)
      expect(snapshot(rs)).toEqual(snapshot(ts))
    }
  })

  it('maps result indices back onto the caller’s own command objects', () => {
    const rs = createPalette(DEMO_COMMANDS)
    rs.start()
    rs.send({ type: 'open' })
    expect(rs.computed.results[0]).toBe(DEMO_COMMANDS[0])
    expect(createPaletteObjects(DEMO_COMMANDS).computed.results).toEqual(DEMO_COMMANDS)
  })

  it('keeps the context mirror identity and notifies once per send', () => {
    const rs = createPalette(DEMO_COMMANDS)
    const ctx = rs.context
    const fn = vi.fn()
    rs.subscribe(fn)
    rs.send({ type: 'open' })
    rs.send({ type: 'query.set', query: 'issue' })
    expect(rs.context).toBe(ctx)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('a selection fires only when its value changes', () => {
    const rs = createPalette(DEMO_COMMANDS)
    const seen: Array<string | null> = []
    rs.select.computed('activeId').subscribe(id => seen.push(id))
    rs.send({ type: 'open' })
    rs.send({ type: 'move', to: 'down' })
    rs.send({ type: 'move', to: 'down' })
    rs.send({ type: 'query.set', query: '' }) // query unchanged, index reset
    expect(seen).toEqual(['issues', 'prs', 'home'])
  })
})

describe('wasm dialog', () => {
  it('runs the `after` timer through the host clock', () => {
    vi.useFakeTimers()
    try {
      const d = createDialog(150)
      d.start()
      d.send({ type: 'open' })
      expect(d.state).toBe('open')
      expect(d.hasTag('visible')).toBe(true)
      d.send({ type: 'close' })
      expect(d.state).toBe('closing')
      vi.advanceTimersByTime(149)
      expect(d.state).toBe('closing')
      vi.advanceTimersByTime(1)
      expect(d.state).toBe('closed')
      expect(d.context.openCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending timer when the state is left early', () => {
    vi.useFakeTimers()
    try {
      const d = createDialog(150)
      d.start()
      d.send({ type: 'open' })
      d.send({ type: 'close' })
      d.send({ type: 'open' }) // back to open before the exit delay ends
      vi.advanceTimersByTime(500)
      expect(d.state).toBe('open')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('wasm constructor', () => {
  it('throws on malformed props instead of guessing', () => {
    expect(() => createPalette([{ id: 1 } as unknown as (typeof DEMO_COMMANDS)[number]])).toThrow()
  })
})
