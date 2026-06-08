/**
 * `after` — timed transitions (auto-cancel on exit).
 *
 * Pins: a numeric-delay `after` fires its transition after the delay while in
 * the state; a NAMED delay resolves from implementations.delays (and may read
 * context → prop-driven); the timer is cancelled if the state is left first or
 * the machine is stopped; `after` reuses guard fallthrough; timers don't fire
 * while stopped. Uses fake timers for determinism.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { machine } from '../src'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('after — timed transitions', () => {
  it('fires a numeric-delay transition after the delay', () => {
    const m = machine<'a' | 'b', object, { type: never }>({
      initial: 'a',
      context: {},
      states: {
        a: { after: { 200: { target: 'b' } } },
        b: {},
      },
    })
    m.start()
    expect(m.state).toBe('a')
    vi.advanceTimersByTime(199)
    expect(m.state).toBe('a') // not yet
    vi.advanceTimersByTime(1)
    expect(m.state).toBe('b') // fired at 200ms
  })

  it('resolves a NAMED delay from implementations.delays (prop-driven via context)', () => {
    const m = machine<'opening' | 'open', { openMs: number }, { type: never }>({
      initial: 'opening',
      context: { openMs: 500 },
      states: {
        opening: { after: { openDelay: { target: 'open' } } },
        open: {},
      },
      implementations: { delays: { openDelay: ({ context }) => context.openMs } },
    })
    m.start()
    vi.advanceTimersByTime(499)
    expect(m.state).toBe('opening')
    vi.advanceTimersByTime(1)
    expect(m.state).toBe('open')
  })

  it('auto-cancels the timer when the state is left first', () => {
    const m = machine<'a' | 'b' | 'c', object, { type: 'escape' }>({
      initial: 'a',
      context: {},
      states: {
        a: { after: { 200: { target: 'b' } }, on: { escape: { target: 'c' } } },
        b: {},
        c: {},
      },
    })
    m.start()
    m.send({ type: 'escape' }) // leave 'a' before 200ms → timer cancelled
    expect(m.state).toBe('c')
    vi.advanceTimersByTime(500)
    expect(m.state).toBe('c') // the 'a' timer never fired
  })

  it('does not fire while stopped; stop() cancels a pending timer', () => {
    const m = machine<'a' | 'b', object, { type: never }>({
      initial: 'a',
      context: {},
      states: { a: { after: { 100: { target: 'b' } } }, b: {} },
    })
    // never started → no timer scheduled
    vi.advanceTimersByTime(500)
    expect(m.state).toBe('a')

    m.start()
    m.stop() // cancels the pending 'a' timer
    vi.advanceTimersByTime(500)
    expect(m.state).toBe('a')
  })

  it('after reuses guard fallthrough — first passing transition wins', () => {
    const m = machine<'idle' | 'hi' | 'lo', { n: number }, { type: never }>({
      initial: 'idle',
      context: { n: 8 },
      states: {
        idle: {
          after: {
            100: [
              { guard: ({ context }) => context.n >= 10, target: 'hi' },
              { target: 'lo' }, // fallback
            ],
          },
        },
        hi: {},
        lo: {},
      },
    })
    m.start()
    vi.advanceTimersByTime(100)
    expect(m.state).toBe('lo') // n=8 < 10 → fallback
  })

  it('a timer can run actions on the way through', () => {
    const ran: string[] = []
    const m = machine<'a' | 'b', object, { type: never }>({
      initial: 'a',
      context: {},
      states: {
        a: { after: { 50: { target: 'b', actions: [() => ran.push('tick')] } } },
        b: { entry: [() => ran.push('entered-b')] },
      },
    })
    m.start()
    vi.advanceTimersByTime(50)
    expect(ran).toEqual(['tick', 'entered-b'])
    expect(m.state).toBe('b')
  })

  it('sleep pattern: a waiting state auto-advances', () => {
    const m = machine<'flash' | 'idle', object, { type: 'show' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: { on: { show: { target: 'flash' } } },
        flash: { after: { 300: { target: 'idle' } } }, // show, then auto-return
      },
    })
    m.start()
    m.send({ type: 'show' })
    expect(m.state).toBe('flash')
    vi.advanceTimersByTime(300)
    expect(m.state).toBe('idle')
  })

  it('throws in dev when a named delay is not registered', () => {
    const m = machine<'a' | 'b', object, { type: never }>({
      initial: 'a',
      context: {},
      states: { a: { after: { missing: { target: 'b' } } }, b: {} },
    })
    expect(() => m.start()).toThrow(/no delay "missing"/)
  })

  it('an after transition whose action sends further events drains them (run-to-completion)', () => {
    // The fired timer runs its own drain loop; an event queued by an after
    // action must be processed in the same drain, not dropped.
    const log: string[] = []
    const m = machine<'a' | 'b' | 'c', object, { type: 'chain' }>({
      initial: 'a',
      context: {},
      states: {
        a: {
          after: {
            10: { target: 'b', actions: [({ send }) => send({ type: 'chain' })] },
          },
        },
        b: { on: { chain: { target: 'c', actions: [() => log.push('chained')] } } },
        c: { entry: [() => log.push('entered-c')] },
      },
    })
    m.start()
    vi.advanceTimersByTime(10) // a → b (timer), then queued 'chain' → c
    expect(m.state).toBe('c')
    expect(log).toEqual(['chained', 'entered-c'])
  })

  it('re-entering the timed state restarts its timer (the prior entry’s does not carry over)', () => {
    // a (100ms → done) ⇄ park. Leave `a` at 60ms, come back: the clock for the
    // auto-advance restarts from the re-entry, so the original 100ms deadline is
    // dead. Pins that a state's `after` is scoped to its CURRENT entry.
    const m = machine<'a' | 'park' | 'done', object, { type: 'leave' | 'back' }>({
      initial: 'a',
      context: {},
      states: {
        a: { after: { 100: { target: 'done' } }, on: { leave: { target: 'park' } } },
        park: { on: { back: { target: 'a' } } },
        done: {},
      },
    })
    m.start()
    vi.advanceTimersByTime(60) // 60ms into the first entry's timer
    m.send({ type: 'leave' }) // exit a → timer cancelled
    expect(m.state).toBe('park')
    vi.advanceTimersByTime(50) // 60+50=110 > 100, but that timer is gone
    expect(m.state).toBe('park') // the dead timer never fired
    m.send({ type: 'back' }) // re-enter a → fresh 100ms timer
    vi.advanceTimersByTime(60)
    expect(m.state).toBe('a') // not yet (only 60ms into the NEW timer)
    vi.advanceTimersByTime(40)
    expect(m.state).toBe('done') // fresh timer completes at 100ms
  })
})
