/**
 * Round 5c — oneOf (conditional action branch).
 *
 * Pins: oneOf runs the FIRST branch whose guard passes (short-circuit), a
 * guardless branch is the fallback, it composes with unconditional actions in
 * a list, and branch guards use names/inline/combinators.
 */
import { describe, expect, it } from 'vitest'
import { createTransitions, oneOf } from '../src/machine'

describe('R5c — oneOf', () => {
  it('runs the first branch whose guard passes', () => {
    const hit: string[] = []
    const m = createTransitions<'idle', { kind: 'a' | 'b' | 'c' }, { type: 'go' }>({
      initial: 'idle',
      context: { kind: 'b' },
      states: {
        idle: {
          on: {
            go: {
              actions: [
                oneOf([
                  { guard: ({ context }) => context.kind === 'a', actions: [() => hit.push('a')] },
                  { guard: ({ context }) => context.kind === 'b', actions: [() => hit.push('b')] },
                  { actions: [() => hit.push('fallback')] },
                ]),
              ],
            },
          },
        },
      },
    })
    m.send({ type: 'go' })
    expect(hit).toEqual(['b']) // only the matching branch; not fallback
  })

  it('guardless branch is the fallback when nothing matches', () => {
    const hit: string[] = []
    const m = createTransitions<'idle', { n: number }, { type: 'go' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: {
            go: {
              actions: [
                oneOf([
                  { guard: ({ context }) => context.n > 0, actions: [() => hit.push('positive')] },
                  { actions: [() => hit.push('fallback')] },
                ]),
              ],
            },
          },
        },
      },
    })
    m.send({ type: 'go' }) // n=0 → no guard matches → fallback
    expect(hit).toEqual(['fallback'])
  })

  it('runs nothing if no branch matches and there is no fallback', () => {
    const hit: string[] = []
    const m = createTransitions<'idle', { n: number }, { type: 'go' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: {
            go: {
              actions: [
                oneOf([{ guard: ({ context }) => context.n > 0, actions: [() => hit.push('x')] }]),
              ],
            },
          },
        },
      },
    })
    m.send({ type: 'go' })
    expect(hit).toEqual([])
  })

  it('composes with unconditional actions in the same list, in order', () => {
    const order: string[] = []
    const m = createTransitions<'idle', { mobile: boolean }, { type: 'open' }>({
      initial: 'idle',
      context: { mobile: true },
      states: {
        idle: {
          on: {
            open: {
              actions: [
                () => order.push('always-before'),
                oneOf([{ guard: 'isMobile', actions: ['lockScroll'] }]),
                () => order.push('always-after'),
              ],
            },
          },
        },
      },
      implementations: {
        guards: { isMobile: ({ context }) => context.mobile },
        actions: { lockScroll: () => order.push('lockScroll') },
      },
    })
    m.send({ type: 'open' })
    expect(order).toEqual(['always-before', 'lockScroll', 'always-after'])
  })

  it('branch guards accept registered names', () => {
    const hit: string[] = []
    const m = createTransitions<'idle', { admin: boolean }, { type: 'go' }>({
      initial: 'idle',
      context: { admin: true },
      states: {
        idle: {
          on: {
            go: {
              actions: [
                oneOf([{ guard: 'isAdmin', actions: ['adminPath'] }, { actions: ['userPath'] }]),
              ],
            },
          },
        },
      },
      implementations: {
        guards: { isAdmin: ({ context }) => context.admin },
        actions: { adminPath: () => hit.push('admin'), userPath: () => hit.push('user') },
      },
    })
    m.send({ type: 'go' })
    expect(hit).toEqual(['admin'])
  })
})
