/**
 * Transitions.
 *
 * Pins: per-state `on` + top-level `on`; guard-fallthrough arrays; internal
 * self-transitions (actions, no exit/entry); and the key decision — QUEUED
 * send (a re-entrant send completes the current transition first).
 */
import { describe, expect, it } from 'vitest'
import { machine } from '../src'

describe('transitions', () => {
  it('moves between states on a matching event', () => {
    const m = machine<'closed' | 'open', { n: number }, { type: 'open' | 'close' }>({
      initial: 'closed',
      context: { n: 0 },
      states: {
        closed: { on: { open: { target: 'open' } } },
        open: { on: { close: { target: 'closed' } } },
      },
    })
    expect(m.state).toBe('closed')
    m.send({ type: 'open' })
    expect(m.state).toBe('open')
    m.send({ type: 'close' })
    expect(m.state).toBe('closed')
  })

  it('ignores events with no transition in the current state', () => {
    const m = machine<'closed' | 'open', object, { type: 'open' | 'close' }>({
      initial: 'closed',
      context: {},
      states: {
        closed: { on: { open: { target: 'open' } } },
        open: { on: { close: { target: 'closed' } } },
      },
    })
    m.send({ type: 'close' }) // no 'close' in 'closed'
    expect(m.state).toBe('closed')
  })

  it('top-level `on` handles any-state events; per-state takes precedence', () => {
    const m = machine<'a' | 'b' | 'gone', object, { type: 'go' | 'kill' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { go: { target: 'b' } } },
        b: {},
        gone: {},
      },
      on: { kill: { target: 'gone' } }, // works from any state
    })
    m.send({ type: 'go' })
    expect(m.state).toBe('b')
    m.send({ type: 'kill' }) // top-level, from 'b'
    expect(m.state).toBe('gone')
  })

  it('guard fallthrough: first transition whose guard passes wins', () => {
    const m = machine<'idle', { x: number }, { type: 'tick' }>({
      initial: 'idle',
      context: { x: 5 },
      states: {
        idle: {
          on: {
            tick: [
              {
                guard: ({ context }) => context.x > 10,
                actions: [({ setContext }) => setContext({ x: 999 })],
              },
              {
                guard: ({ context }) => context.x > 0,
                actions: [({ setContext }) => setContext({ x: 1 })],
              },
              { actions: [({ setContext }) => setContext({ x: -1 })] }, // fallback
            ],
          },
        },
      },
    })
    m.send({ type: 'tick' }) // x=5: first guard false, second true → x=1
    expect(m.context.x).toBe(1)
  })

  it('internal self-transition runs actions without exit/entry', () => {
    let ran = 0
    const m = machine<'idle', { n: number }, { type: 'bump' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: {
            bump: {
              // no target → self-transition
              actions: [
                ({ context, setContext }) => {
                  ran++
                  setContext({ n: context.n + 1 })
                },
              ],
            },
          },
        },
      },
    })
    m.send({ type: 'bump' })
    m.send({ type: 'bump' })
    expect(ran).toBe(2)
    expect(m.context.n).toBe(2)
    expect(m.state).toBe('idle')
  })

  it('QUEUED send: a re-entrant send from an action runs AFTER the current transition completes', () => {
    // The snippet scenario: opening fires `auto.close` from an action. Under a
    // queue, auto.close is processed against the NEW state ('open'), so it
    // matches and closes — final state 'closed'. (Pure-sync would lose it.)
    const order: string[] = []
    const m = machine<'closed' | 'open', object, { type: 'open' | 'auto.close' }>({
      initial: 'closed',
      context: {},
      states: {
        closed: {
          on: {
            open: {
              target: 'open',
              actions: [
                ({ send }) => {
                  order.push('announce')
                  send({ type: 'auto.close' }) // re-entrant
                },
              ],
            },
          },
        },
        open: {
          on: { 'auto.close': { target: 'closed', actions: [() => order.push('closed')] } },
        },
      },
    })

    m.send({ type: 'open' })
    // announce ran during the `open` transition; auto.close processed AFTER,
    // against state 'open', and matched → final 'closed'.
    expect(order).toEqual(['announce', 'closed'])
    expect(m.state).toBe('closed')
  })

  it('QUEUED send: events from outside also serialize (no interleaving)', () => {
    const seen: string[] = []
    const m = machine<'a' | 'b' | 'c', object, { type: 'toB' | 'toC' }>({
      initial: 'a',
      context: {},
      states: {
        a: {
          on: {
            toB: {
              target: 'b',
              actions: [({ send }) => send({ type: 'toC' })], // queue toC
            },
          },
        },
        b: { on: { toC: { target: 'c', actions: [() => seen.push('b→c')] } } },
        c: {},
      },
    })
    m.send({ type: 'toB' })
    expect(seen).toEqual(['b→c'])
    expect(m.state).toBe('c')
  })
})
