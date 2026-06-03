/**
 * Actions — side-effects a transition (or entry/exit) runs, in order. Inline or
 * named (from implementations.actions); a missing name throws in dev. `oneOf`
 * picks one branch by guard. entry/exit run around the switch.
 */
import { machine, oneOf } from '../src'
import { describe, expect, it } from 'vitest'

describe('inline actions', () => {
  it('runs an inline action that mutates context', () => {
    const m = machine<'idle', { n: number }, { type: 'inc' }>({
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
    const m = machine<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            go: { actions: [() => order.push('a'), () => order.push('b'), () => order.push('c')] },
          },
        },
      },
    })
    m.send({ type: 'go' })
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('an action can read the event payload', () => {
    const m = machine<'idle', { last: string }, { type: 'set'; value: string }>({
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

  it('an action can queue an event via send', () => {
    const seen: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' | 'mark' }>({
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

  it('action params include `computed` (empty when none configured)', () => {
    let sawComputed: unknown
    const m = machine<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: { idle: { on: { go: { actions: [({ computed }) => (sawComputed = computed)] } } } },
    })
    m.send({ type: 'go' })
    expect(sawComputed).toEqual({})
  })
})

describe('named actions', () => {
  it('resolves actions by name from implementations.actions', () => {
    const m = machine<'idle', { n: number }, { type: 'go' }>({
      initial: 'idle',
      context: { n: 0 },
      states: { idle: { on: { go: { actions: ['inc', 'inc'] } } } },
      implementations: {
        actions: { inc: ({ context, setContext }) => setContext({ n: context.n + 1 }) },
      },
    })
    m.send({ type: 'go' })
    expect(m.context.n).toBe(2)
  })

  it('named and inline actions coexist and run in order', () => {
    const order: string[] = []
    const m = machine<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: { idle: { on: { go: { actions: ['first', () => order.push('inline'), 'last'] } } } },
      implementations: {
        actions: { first: () => order.push('first'), last: () => order.push('last') },
      },
    })
    m.send({ type: 'go' })
    expect(order).toEqual(['first', 'inline', 'last'])
  })

  it('throws in dev when an action name is not registered', () => {
    const m = machine<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: { idle: { on: { go: { actions: ['missing'] } } } },
    })
    expect(() => m.send({ type: 'go' })).toThrow(/no action "missing"/)
  })
})

describe('oneOf — conditional action branch', () => {
  it('runs the first branch whose guard passes', () => {
    const hit: string[] = []
    const m = machine<'idle', { kind: 'a' | 'b' | 'c' }, { type: 'go' }>({
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
    expect(hit).toEqual(['b'])
  })

  it('guardless branch is the fallback when nothing matches', () => {
    const hit: string[] = []
    const m = machine<'idle', { n: number }, { type: 'go' }>({
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
    m.send({ type: 'go' }) // n=0 → fallback
    expect(hit).toEqual(['fallback'])
  })

  it('runs nothing if no branch matches and there is no fallback', () => {
    const hit: string[] = []
    const m = machine<'idle', { n: number }, { type: 'go' }>({
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
    const m = machine<'idle', { mobile: boolean }, { type: 'open' }>({
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
    const m = machine<'idle', { admin: boolean }, { type: 'go' }>({
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

describe('entry / exit', () => {
  it('orders exit(old) → transition actions → entry(new)', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' }>({
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
    machine<'a', object, { type: 'noop' }>({
      initial: 'a',
      context: {},
      states: { a: { entry: [() => order.push('entry:a')] } },
    })
    expect(order).toEqual([]) // entry fires on transition INTO a state, not at boot
  })

  it('internal self-transition (no target) skips entry+exit', () => {
    const order: string[] = []
    const m = machine<'a', { n: number }, { type: 'tick' }>({
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
    expect(m.context.n).toBe(1) // transition actions still ran
  })

  it('self-transition with explicit same target also skips entry+exit', () => {
    const order: string[] = []
    const m = machine<'a', object, { type: 'self' }>({
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
    expect(order).toEqual(['action'])
  })

  it('entry/exit run by name and via oneOf', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', { mobile: boolean }, { type: 'toB' }>({
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
    const m = machine<'a' | 'b' | 'c', object, { type: 'toB' | 'auto' }>({
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
    expect(order).toEqual(['entry:b', 'entry:c'])
    expect(m.state).toBe('c')
  })
})
