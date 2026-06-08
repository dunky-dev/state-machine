/**
 * Lifecycle — machine() returns a BUILT but STOPPED service: no effects run
 * until start(). start() boots the initial-state effects (MACHINE_INIT); stop()
 * runs their cleanups; start again re-boots. send() works regardless of running
 * (state is pure), but transition effects only boot/cleanup while running.
 */
import { describe, expect, it, vi } from 'vitest'
import { machine } from '../src'

describe('lifecycle — start / stop', () => {
  it('is built stopped: no effects until start()', () => {
    const fx = vi.fn()
    const m = machine<'idle', object, { type: 'x' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [fx] } },
    })
    expect(fx).not.toHaveBeenCalled()
    m.start()
    expect(fx).toHaveBeenCalledTimes(1)
  })

  it('start() is idempotent — a second start does not double-boot', () => {
    const fx = vi.fn()
    const m = machine<'idle', object, { type: 'x' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [fx] } },
    })
    m.start()
    m.start()
    expect(fx).toHaveBeenCalledTimes(1)
  })

  it('stop() runs active effect cleanups; idempotent', () => {
    const cleanup = vi.fn()
    const m = machine<'idle', object, { type: 'x' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [() => cleanup] } },
    })
    m.start()
    m.stop()
    expect(cleanup).toHaveBeenCalledTimes(1)
    m.stop() // already stopped → no-op
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('send() transitions while STOPPED, but runs no effects', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', { n: number }, { type: 'toB' }>({
      initial: 'a',
      context: { n: 0 },
      states: {
        a: {
          exit: [() => order.push('exit-action')], // actions DO run
          effects: [() => () => order.push('effect-cleanup')], // effects do NOT (stopped)
          on: { toB: { target: 'b', actions: [({ setContext }) => setContext({ n: 1 })] } },
        },
        b: {
          entry: [() => order.push('entry-action')],
          effects: [() => void order.push('effect-start')],
        },
      },
    })
    // never started
    m.send({ type: 'toB' })
    expect(m.state).toBe('b') // transition happened
    expect(m.context.n).toBe(1) // transition action ran
    expect(order).toEqual(['exit-action', 'entry-action']) // actions only; no effect start/cleanup
  })

  it('effects boot/cleanup only while running', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' }>({
      initial: 'a',
      context: {},
      states: {
        a: {
          effects: [() => () => order.push('a:cleanup')],
          on: { toB: { target: 'b' } },
        },
        b: { effects: [() => void order.push('b:start')] },
      },
    })
    m.start() // boots a's effect (no log; returns cleanup only)
    m.send({ type: 'toB' }) // a's cleanup runs, b's effect starts
    expect(order).toEqual(['a:cleanup', 'b:start'])
  })
})
