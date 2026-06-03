/**
 * Guards — predicates that gate transitions: inline fns, named (resolved from
 * implementations.guards), and the and/or/not combinators. Guards receive
 * { context, event, computed }. A missing name throws in dev.
 */
import { and, machine, not, or } from '../src'
import { describe, expect, it } from 'vitest'

describe('inline guards', () => {
  it('an inline guard gates the transition (true = taken)', () => {
    const m = machine<'idle', { allow: boolean }, { type: 'go' }>({
      initial: 'idle',
      context: { allow: true },
      states: {
        idle: {
          on: {
            go: {
              guard: ({ context }) => context.allow,
              actions: [({ setContext }) => setContext({ allow: false })],
            },
          },
        },
      },
    })
    m.send({ type: 'go' }) // allow=true → runs → sets allow=false
    expect(m.context.allow).toBe(false)
    m.send({ type: 'go' }) // allow=false → guard blocks → no change
    expect(m.context.allow).toBe(false)
  })

  it('a guard can read the event payload', () => {
    const m = machine<'idle', { n: number }, { type: 'add'; by: number }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: {
            add: {
              guard: ({ event }) => event.by > 0, // only positive additions
              actions: [
                ({ context, setContext, event }) => setContext({ n: context.n + event.by }),
              ],
            },
          },
        },
      },
    })
    m.send({ type: 'add', by: 5 })
    expect(m.context.n).toBe(5)
    m.send({ type: 'add', by: -3 }) // guard blocks negative
    expect(m.context.n).toBe(5)
  })

  it('guard params include `computed` (empty when no computed configured)', () => {
    let sawComputed: unknown
    const m = machine<'idle', object, { type: 'check' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            check: {
              guard: ({ computed }) => {
                sawComputed = computed
                return true
              },
              actions: [],
            },
          },
        },
      },
    })
    m.send({ type: 'check' })
    expect(sawComputed).toEqual({})
  })
})

describe('named guards', () => {
  it('resolves a guard by name from implementations.guards', () => {
    const m = machine<'idle', { allow: boolean }, { type: 'go' }>({
      initial: 'idle',
      context: { allow: true },
      states: {
        idle: {
          on: {
            go: { guard: 'isAllowed', actions: [({ setContext }) => setContext({ allow: false })] },
          },
        },
      },
      implementations: { guards: { isAllowed: ({ context }) => context.allow } },
    })
    m.send({ type: 'go' }) // isAllowed true → runs
    expect(m.context.allow).toBe(false)
    m.send({ type: 'go' }) // isAllowed false → blocked
    expect(m.context.allow).toBe(false)
  })

  it('named and inline guards coexist (fallthrough array)', () => {
    const m = machine<'idle', { n: number }, { type: 'tick' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: {
            tick: [
              { guard: 'never', actions: [({ setContext }) => setContext({ n: 99 })] },
              {
                guard: ({ context }) => context.n < 3,
                actions: [({ context, setContext }) => setContext({ n: context.n + 1 })],
              },
            ],
          },
        },
      },
      implementations: { guards: { never: () => false } },
    })
    m.send({ type: 'tick' }) // 'never' false → falls to inline → n=1
    expect(m.context.n).toBe(1)
  })

  it('throws in dev when a guard name is not registered', () => {
    const m = machine<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: { idle: { on: { go: { guard: 'missing', actions: [] } } } },
    })
    expect(() => m.send({ type: 'go' })).toThrow(/no guard "missing"/)
  })
})

describe('combinators — and / or / not', () => {
  it('and(): true only when every sub-guard passes (names)', () => {
    let ran = false
    const m = machine<'idle', { a: boolean; b: boolean }, { type: 'go' }>({
      initial: 'idle',
      context: { a: true, b: true },
      states: {
        idle: { on: { go: { guard: and('isA', 'isB'), actions: [() => (ran = true)] } } },
      },
      implementations: {
        guards: { isA: ({ context }) => context.a, isB: ({ context }) => context.b },
      },
    })
    m.send({ type: 'go' })
    expect(ran).toBe(true)
  })

  it('and(): blocks when one sub-guard fails', () => {
    let ran = false
    const m = machine<'idle', { a: boolean; b: boolean }, { type: 'go' }>({
      initial: 'idle',
      context: { a: true, b: false },
      states: {
        idle: { on: { go: { guard: and('isA', 'isB'), actions: [() => (ran = true)] } } },
      },
      implementations: {
        guards: { isA: ({ context }) => context.a, isB: ({ context }) => context.b },
      },
    })
    m.send({ type: 'go' })
    expect(ran).toBe(false)
  })

  it('or(): true when any passes; not(): negates; mixed names + inline fns', () => {
    let ran = false
    const m = machine<'idle', { locked: boolean }, { type: 'go'; force?: boolean }>({
      initial: 'idle',
      context: { locked: true },
      states: {
        idle: {
          on: {
            go: {
              guard: or(({ event }) => !!event.force, not('isLocked')),
              actions: [() => (ran = true)],
            },
          },
        },
      },
      implementations: { guards: { isLocked: ({ context }) => context.locked } },
    })
    m.send({ type: 'go' }) // locked, no force → blocked
    expect(ran).toBe(false)
    m.send({ type: 'go', force: true }) // force → or passes → runs
    expect(ran).toBe(true)
  })

  it('combinators accept inline functions too (not just names)', () => {
    let ran = false
    const isPos = ({ context }: { context: { n: number } }) => context.n > 0
    const m = machine<'idle', { n: number }, { type: 'go' }>({
      initial: 'idle',
      context: { n: 5 },
      states: {
        idle: {
          on: {
            go: {
              guard: and(
                isPos,
                not(({ context }) => context.n > 100),
              ),
              actions: [() => (ran = true)],
            },
          },
        },
      },
    })
    m.send({ type: 'go' }) // n=5: >0 AND not(>100) → true
    expect(ran).toBe(true)
  })

  it('nests deeply: and(or(...), not(and(...)))', () => {
    let ran = false
    const m = machine<'idle', { x: number }, { type: 'go' }>({
      initial: 'idle',
      context: { x: 2 },
      states: {
        idle: {
          on: {
            go: {
              guard: and(or('isTwo', 'isThree'), not(and('isTwo', 'isOdd'))),
              actions: [() => (ran = true)],
            },
          },
        },
      },
      implementations: {
        guards: {
          isTwo: ({ context }) => context.x === 2,
          isThree: ({ context }) => context.x === 3,
          isOdd: ({ context }) => context.x % 2 === 1,
        },
      },
    })
    // x=2: or(isTwo,isThree)=true; and(isTwo,isOdd)=false; not(false)=true → true
    m.send({ type: 'go' })
    expect(ran).toBe(true)
  })
})
