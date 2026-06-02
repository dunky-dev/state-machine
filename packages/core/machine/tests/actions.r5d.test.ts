/**
 * Round 5d — entry / exit action lists.
 *
 * Pins the order around a transition: exit(old) → transition actions →
 * switch → entry(new). Self-transitions (no target / same target) skip
 * entry+exit. Entry/exit reuse the action machinery (names, inline, oneOf).
 */
import { describe, expect, it } from 'vitest'
import { createTransitions, oneOf } from '../src/machine'

describe('R5d — entry / exit', () => {
  it('runs entry of the initial-targeted state and orders exit→actions→entry', () => {
    const order: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' }>({
      initial: 'a',
      context: {},
      states: {
        a: {
          exit: [() => order.push('exit:a')],
          on: { toB: { target: 'b', actions: [() => order.push('action:toB')] } },
        },
        b: { entry: [() => order.push('entry:b')] },
      },
    })
    m.send({ type: 'toB' })
    expect(order).toEqual(['exit:a', 'action:toB', 'entry:b'])
    expect(m.state).toBe('b')
  })

  it('does NOT run entry of the initial state at construction', () => {
    const order: string[] = []
    createTransitions<'a', object, { type: 'noop' }>({
      initial: 'a',
      context: {},
      states: { a: { entry: [() => order.push('entry:a')] } },
    })
    expect(order).toEqual([]) // entry fires on transition INTO a state, not at boot
  })

  it('internal self-transition (no target) skips entry+exit', () => {
    const order: string[] = []
    const m = createTransitions<'a', { n: number }, { type: 'tick' }>({
      initial: 'a',
      context: { n: 0 },
      states: {
        a: {
          entry: [() => order.push('entry:a')],
          exit: [() => order.push('exit:a')],
          on: {
            tick: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] },
          },
        },
      },
    })
    m.send({ type: 'tick' })
    expect(order).toEqual([]) // no state change → no entry/exit
    expect(m.context.n).toBe(1) // but transition actions still ran
  })

  it('self-transition WITH explicit same target also skips entry+exit', () => {
    const order: string[] = []
    const m = createTransitions<'a', object, { type: 'self' }>({
      initial: 'a',
      context: {},
      states: {
        a: {
          entry: [() => order.push('entry:a')],
          exit: [() => order.push('exit:a')],
          on: { self: { target: 'a', actions: [() => order.push('action')] } },
        },
      },
    })
    m.send({ type: 'self' })
    expect(order).toEqual(['action']) // changed=false → entry/exit skipped
  })

  it('entry/exit run by name and via oneOf', () => {
    const order: string[] = []
    const m = createTransitions<'a' | 'b', { mobile: boolean }, { type: 'toB' }>({
      initial: 'a',
      context: { mobile: true },
      states: {
        a: { exit: ['logExit'], on: { toB: { target: 'b' } } },
        b: {
          entry: [
            oneOf([{ guard: 'isMobile', actions: ['mobileSetup'] }, { actions: ['desktopSetup'] }]),
          ],
        },
      },
      implementations: {
        guards: { isMobile: ({ context }) => context.mobile },
        actions: {
          logExit: () => order.push('exit:a'),
          mobileSetup: () => order.push('mobile'),
          desktopSetup: () => order.push('desktop'),
        },
      },
    })
    m.send({ type: 'toB' })
    expect(order).toEqual(['exit:a', 'mobile'])
  })

  it('entry can queue an event that triggers the next transition (run-to-completion)', () => {
    const order: string[] = []
    const m = createTransitions<'a' | 'b' | 'c', object, { type: 'toB' | 'auto' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: {
          entry: [({ send }) => send({ type: 'auto' }), () => order.push('entry:b')],
          on: { auto: { target: 'c' } },
        },
        c: { entry: [() => order.push('entry:c')] },
      },
    })
    m.send({ type: 'toB' })
    // entry:b finishes (queued 'auto' waits for run-to-completion), then 'auto' → c
    expect(order).toEqual(['entry:b', 'entry:c'])
    expect(m.state).toBe('c')
  })
})
