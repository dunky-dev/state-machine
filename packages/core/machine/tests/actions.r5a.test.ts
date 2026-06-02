/**
 * Round 5a — inline actions + params shape.
 *
 * Pins: an action receives the FINAL { context, setContext, event, send,
 * computed } params (computed is {} until R7); inline actions run in order and
 * can mutate context, read the event, and queue events.
 */
import { describe, expect, it } from 'vitest'
import { createTransitions } from '../src/machine'

describe('R5a — inline actions', () => {
  it('runs an inline action that mutates context', () => {
    const m = createTransitions<'idle', { n: number }, { type: 'inc' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: { inc: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })
    m.send({ type: 'inc' })
    m.send({ type: 'inc' })
    expect(m.context.n).toBe(2)
  })

  it('runs multiple actions in order', () => {
    const order: string[] = []
    const m = createTransitions<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            go: {
              actions: [() => order.push('a'), () => order.push('b'), () => order.push('c')],
            },
          },
        },
      },
    })
    m.send({ type: 'go' })
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('an action can read the event payload', () => {
    const m = createTransitions<'idle', { last: string }, { type: 'set'; value: string }>({
      initial: 'idle',
      context: { last: '' },
      states: {
        idle: {
          on: { set: { actions: [({ setContext, event }) => setContext({ last: event.value })] } },
        },
      },
    })
    m.send({ type: 'set', value: 'hi' })
    expect(m.context.last).toBe('hi')
  })

  it('an action can queue an event via send (R3 queue)', () => {
    const seen: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' | 'mark' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b', actions: [({ send }) => send({ type: 'mark' })] } } },
        b: { on: { mark: { actions: [() => seen.push('marked')] } } },
      },
    })
    m.send({ type: 'toB' })
    expect(m.state).toBe('b')
    expect(seen).toEqual(['marked'])
  })

  it('action params include `computed` (empty until R7)', () => {
    let sawComputed: unknown
    const m = createTransitions<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            go: {
              actions: [
                ({ computed }) => {
                  sawComputed = computed
                },
              ],
            },
          },
        },
      },
    })
    m.send({ type: 'go' })
    expect(sawComputed).toEqual({})
  })
})
