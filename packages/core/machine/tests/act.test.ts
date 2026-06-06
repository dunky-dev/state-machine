/**
 * `act(...)` — terse sugar. Write-only form `act(...patches)` → an Action that
 * applies each patch in order; target form `act('state', ...patches)` → a
 * Transition. A leading string is the target; otherwise every arg is a patch.
 */
import { act, machine } from '../src'
import { describe, expect, it } from 'vitest'

describe('act', () => {
  it('writes a static patch (nested in actions)', () => {
    const m = machine<'idle', { focused: boolean }, { type: 'focus' }>({
      initial: 'idle',
      context: { focused: false },
      states: { idle: { on: { focus: { actions: [act({ focused: true })] } } } },
    })
    m.send({ type: 'focus' })
    expect(m.context.focused).toBe(true)
  })

  it('writes a patch derived from the event', () => {
    const m = machine<'idle', { value: number }, { type: 'set'; value: number }>({
      initial: 'idle',
      context: { value: 0 },
      states: { idle: { on: { set: act(({ event }) => ({ value: event.value })) } } },
    })
    m.send({ type: 'set', value: 42 })
    expect(m.context.value).toBe(42)
  })

  it('reads context in the function form', () => {
    const m = machine<'idle', { n: number }, { type: 'inc' }>({
      initial: 'idle',
      context: { n: 1 },
      states: { idle: { on: { inc: act(({ context }) => ({ n: context.n + 1 })) } } },
    })
    m.send({ type: 'inc' })
    m.send({ type: 'inc' })
    expect(m.context.n).toBe(3)
  })

  it('composes with a target and other actions, in order', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', { hit: boolean }, { type: 'go' }>({
      initial: 'a',
      context: { hit: false },
      states: {
        a: {
          on: {
            go: {
              target: 'b',
              actions: [() => order.push('before'), act({ hit: true }), () => order.push('after')],
            },
          },
        },
        b: {},
      },
    })
    m.send({ type: 'go' })
    expect(m.state).toBe('b')
    expect(m.context.hit).toBe(true)
    expect(order).toEqual(['before', 'after'])
  })
})
