/**
 * `watch` — machine-global data-reactions.
 *
 * Pins: a watched context/computed field runs its actions when the field
 * CHANGES (not on setup); reacts in any state; reuses the action vocabulary
 * (names/inline/oneOf); only runs while the machine is running; cleaned up on
 * stop(); a watcher may send events / setContext.
 */
import { describe, expect, it, vi } from 'vitest'
import { machine } from '../src'

describe('watch — data-reactions', () => {
  it('runs actions when a watched context field changes — not on start', () => {
    const seen: number[] = []
    const m = machine<'idle', { n: number }, { type: 'bump' }>({
      initial: 'idle',
      context: { n: 0 },
      watch: { n: [({ context }) => seen.push(context.n)] },
      states: {
        idle: {
          on: {
            bump: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] },
          },
        },
      },
    })
    m.start()
    expect(seen).toEqual([]) // no fire on setup
    m.send({ type: 'bump' }) // n 0→1
    m.send({ type: 'bump' }) // n 1→2
    expect(seen).toEqual([1, 2])
  })

  it('only fires when the WATCHED field changes, not on unrelated writes', () => {
    const seen: string[] = []
    const m = machine<'idle', { watched: number; other: number }, { type: 'w' | 'o' }>({
      initial: 'idle',
      context: { watched: 0, other: 0 },
      watch: { watched: [() => seen.push('fired')] },
      states: {
        idle: {
          on: {
            w: {
              actions: [({ context, setContext }) => setContext({ watched: context.watched + 1 })],
            },
            o: { actions: [({ context, setContext }) => setContext({ other: context.other + 1 })] },
          },
        },
      },
    })
    m.start()
    m.send({ type: 'o' }) // changes `other` only → watcher silent
    expect(seen).toEqual([])
    m.send({ type: 'w' }) // changes `watched` → fires
    expect(seen).toEqual(['fired'])
  })

  it('watches a computed field', () => {
    const seen: boolean[] = []
    const m = machine<'idle', { items: number[] }, { type: 'add' }, { isEmpty: boolean }>({
      initial: 'idle',
      context: { items: [1] },
      computed: { isEmpty: ({ context }) => context.items.length === 0 },
      watch: { isEmpty: [({ computed }) => seen.push(computed.isEmpty)] },
      states: {
        idle: {
          on: {
            add: {
              actions: [({ context, setContext }) => setContext({ items: [...context.items, 1] })],
            },
          },
        },
      },
    })
    m.start()
    m.send({ type: 'add' }) // items 1→2 but isEmpty stays false → no change → silent
    expect(seen).toEqual([])
  })

  it('reacts in ANY state (machine-global), and a watcher can send', () => {
    const log: string[] = []
    const m = machine<'a' | 'b', { flag: boolean }, { type: 'toB' | 'set' | 'ping' }>({
      initial: 'a',
      context: { flag: false },
      watch: { flag: [({ send }) => send({ type: 'ping' })] },
      states: {
        a: {
          on: {
            toB: { target: 'b' },
            set: { actions: [({ setContext }) => setContext({ flag: true })] },
            ping: { actions: [() => log.push('ping')] },
          },
        },
        b: {
          on: {
            set: { actions: [({ setContext }) => setContext({ flag: false })] },
            ping: { actions: [() => log.push('ping')] },
          },
        },
      },
    })
    m.start()
    m.send({ type: 'set' }) // flag changes in 'a' → watcher sends ping
    m.send({ type: 'toB' })
    m.send({ type: 'set' }) // flag changes in 'b' → watcher sends ping (still active)
    expect(log).toEqual(['ping', 'ping'])
  })

  it('does not fire while stopped; stop() tears watchers down', () => {
    const seen: number[] = []
    const m = machine<'idle', { n: number }, { type: 'bump' }>({
      initial: 'idle',
      context: { n: 0 },
      watch: { n: [({ context }) => seen.push(context.n)] },
      states: {
        idle: {
          on: {
            bump: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] },
          },
        },
      },
    })
    // never started: a change should not fire the watcher
    m.send({ type: 'bump' })
    expect(seen).toEqual([])

    m.start()
    m.send({ type: 'bump' }) // n 1→2 → fires
    expect(seen).toEqual([2])

    m.stop()
    m.send({ type: 'bump' }) // n 2→3 → watcher torn down → silent
    expect(seen).toEqual([2])
  })

  it('multiple watched fields each react independently', () => {
    const seen: string[] = []
    const m = machine<'idle', { a: number; b: number }, { type: 'ba' | 'bb' }>({
      initial: 'idle',
      context: { a: 0, b: 0 },
      watch: {
        a: [() => seen.push('a')],
        b: [() => seen.push('b')],
      },
      states: {
        idle: {
          on: {
            ba: { actions: [({ context, setContext }) => setContext({ a: context.a + 1 })] },
            bb: { actions: [({ context, setContext }) => setContext({ b: context.b + 1 })] },
          },
        },
      },
    })
    m.start()
    m.send({ type: 'ba' })
    m.send({ type: 'bb' })
    m.send({ type: 'ba' })
    expect(seen).toEqual(['a', 'b', 'a'])
  })
})
