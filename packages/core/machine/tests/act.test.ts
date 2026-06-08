/**
 * `act(...patches)` — write-only sugar: returns an Action that applies each patch
 * (a `Partial<Context>` or a `$ => patch` fn) in order via `setContext`. It slots
 * anywhere an action does — nested in `actions: [...]`, bare as an `on` entry
 * (the runtime normalizes a bare fn to `{ actions: [fn] }`), or in a `oneOf`
 * branch. It only WRITES; `target`/`guard` live on the transition object.
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

  it('writes a patch derived from the event (bare on entry)', () => {
    const m = machine<'idle', { value: number }, { type: 'set'; value: number }>({
      initial: 'idle',
      context: { value: 0 },
      states: { idle: { on: { set: act($ => ({ value: $.event.value })) } } },
    })
    m.send({ type: 'set', value: 42 })
    expect(m.context.value).toBe(42)
  })

  it('reads context in the function form', () => {
    const m = machine<'idle', { n: number }, { type: 'inc' }>({
      initial: 'idle',
      context: { n: 1 },
      states: { idle: { on: { inc: act($ => ({ n: $.context.n + 1 })) } } },
    })
    m.send({ type: 'inc' })
    m.send({ type: 'inc' })
    expect(m.context.n).toBe(3)
  })

  it('applies multiple patches in order — a later patch sees earlier writes', () => {
    const m = machine<'idle', { n: number; label: string }, { type: 'bump' }>({
      initial: 'idle',
      context: { n: 0, label: '' },
      states: {
        idle: {
          on: {
            // static patch, then a fn that reads the just-written n. Mixed
            // object+fn args defeat inference (Context is inferred from the first
            // arg only), so annotate — see act's doc comment.
            bump: act<{ n: number; label: string }, { type: 'bump' }>({ n: 5 }, $ => ({
              label: `n=${$.context.n}`,
            })),
          },
        },
      },
    })
    m.send({ type: 'bump' })
    expect(m.context.n).toBe(5)
    expect(m.context.label).toBe('n=5') // sees n=5, not the pre-act 0
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
