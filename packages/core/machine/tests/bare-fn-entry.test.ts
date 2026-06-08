/**
 * Bare-fn transition entry (form "B"): an `on` entry may be a bare action
 * function — shorthand for a guardless, targetless transition `{ actions: [fn] }`.
 * It works standalone and as an array element; arrays stay fallthrough
 * ("first passing guard wins"), and a bare fn is guardless so it always matches
 * (a fallback). Targets always live in the object form.
 */
import { act, machine } from '../src'
import { describe, expect, it } from 'vitest'

describe('bare-fn transition entry', () => {
  it('a standalone bare fn runs as an action, no state change', () => {
    const m = machine<'idle', { n: number }, { type: 'bump' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: { on: { bump: ({ setContext, context }) => setContext({ n: context.n + 1 }) } },
      },
    })
    m.send({ type: 'bump' })
    expect(m.context.n).toBe(1)
    expect(m.state).toBe('idle') // no target → stays put
  })

  it('act(...) works bare in the entry slot', () => {
    const m = machine<'idle', { focused: boolean }, { type: 'focus' }>({
      initial: 'idle',
      context: { focused: false },
      states: { idle: { on: { focus: act({ focused: true }) } } },
    })
    m.send({ type: 'focus' })
    expect(m.context.focused).toBe(true)
  })

  it('the bare fn sees the (narrowed) event', () => {
    let seen: number | undefined
    const m = machine<'idle', { last: number }, { type: 'set'; value: number }>({
      initial: 'idle',
      context: { last: 0 },
      states: {
        idle: {
          on: {
            set: ({ event, setContext }) => {
              seen = event.value
              setContext({ last: event.value })
            },
          },
        },
      },
    })
    m.send({ type: 'set', value: 7 })
    expect(seen).toBe(7)
    expect(m.context.last).toBe(7)
  })

  it('a bare fn as the last array element is the guardless fallback', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', { hit: boolean }, { type: 'go' }>({
      initial: 'a',
      context: { hit: false },
      states: {
        a: {
          on: {
            go: [
              { guard: () => false, target: 'b' }, // skipped
              ({ setContext }) => {
                order.push('fallback')
                setContext({ hit: true })
              }, // matches
            ],
          },
        },
        b: {},
      },
    })
    m.send({ type: 'go' })
    expect(order).toEqual(['fallback'])
    expect(m.context.hit).toBe(true)
    expect(m.state).toBe('a') // fallback fn has no target
  })

  it('a passing guarded transition before a bare fn wins (fn does not run)', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', { hit: boolean }, { type: 'go' }>({
      initial: 'a',
      context: { hit: false },
      states: {
        a: {
          on: {
            go: [
              { guard: () => true, target: 'b', actions: [() => order.push('transition')] }, // wins
              ({ setContext }) => {
                order.push('fn')
                setContext({ hit: true })
              }, // never reached
            ],
          },
        },
        b: {},
      },
    })
    m.send({ type: 'go' })
    expect(order).toEqual(['transition'])
    expect(m.context.hit).toBe(false) // bare fn never ran (earlier guard passed)
    expect(m.state).toBe('b')
  })

  it('object form still works for targets alongside a bare-fn sibling event', () => {
    const m = machine<'a' | 'b', { n: number }, { type: 'go' } | { type: 'tick' }>({
      initial: 'a',
      context: { n: 0 },
      states: {
        a: {
          on: {
            go: { target: 'b' }, // object form: target
            tick: act(({ context }) => ({ n: context.n + 1 })), // bare form: do-only
          },
        },
        b: {},
      },
    })
    m.send({ type: 'tick' })
    expect(m.context.n).toBe(1)
    expect(m.state).toBe('a')
    m.send({ type: 'go' })
    expect(m.state).toBe('b')
  })
})
