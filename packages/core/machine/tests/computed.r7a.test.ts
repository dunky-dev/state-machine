/**
 * Round 7a — computed: derived state from context.
 *
 * Pins: a computed def derives a value from context; it's a lazy/memoized
 * preact computed (recomputes only when a cell it read changes); and the
 * `computed` bag — formerly {} — is now real inside guard/action/effect
 * params. Layer-surfacing (m.computed) is 7c; here we observe via params.
 */
import { describe, expect, it } from 'vitest'
import { createTransitions } from '../src/machine'

describe('R7a — computed from context', () => {
  it('derives a value from context, readable in an action', () => {
    let seen: boolean | undefined
    const m = createTransitions<
      'idle',
      { items: number[] },
      { type: 'check' },
      { isEmpty: boolean }
    >({
      initial: 'idle',
      context: { items: [] },
      computed: { isEmpty: ({ context }) => context.items.length === 0 },
      states: {
        idle: {
          on: {
            check: {
              actions: [
                ({ computed }) => {
                  seen = computed.isEmpty
                },
              ],
            },
          },
        },
      },
    })
    m.send({ type: 'check' })
    expect(seen).toBe(true)
  })

  it('recomputes after the context it reads changes', () => {
    const seen: boolean[] = []
    const m = createTransitions<
      'idle',
      { items: number[] },
      { type: 'add' | 'check' },
      { isEmpty: boolean }
    >({
      initial: 'idle',
      context: { items: [] },
      computed: { isEmpty: ({ context }) => context.items.length === 0 },
      states: {
        idle: {
          on: {
            add: {
              actions: [({ context, setContext }) => setContext({ items: [...context.items, 1] })],
            },
            check: { actions: [({ computed }) => seen.push(computed.isEmpty)] },
          },
        },
      },
    })
    m.send({ type: 'check' }) // empty → true
    m.send({ type: 'add' })
    m.send({ type: 'check' }) // now has 1 item → false
    expect(seen).toEqual([true, false])
  })

  it('is available to a guard', () => {
    const m = createTransitions<
      'idle' | 'done',
      { items: number[] },
      { type: 'finish' },
      { isEmpty: boolean }
    >({
      initial: 'idle',
      context: { items: [42] },
      computed: { isEmpty: ({ context }) => context.items.length === 0 },
      states: {
        // only finish when NOT empty
        idle: { on: { finish: { target: 'done', guard: ({ computed }) => !computed.isEmpty } } },
        done: {},
      },
    })
    m.send({ type: 'finish' })
    expect(m.state).toBe('done') // has items → not empty → guard passes
  })

  it('is available to an effect at boot', () => {
    let seen: number | undefined
    createTransitions<'idle', { items: number[] }, { type: 'noop' }, { count: number }>({
      initial: 'idle',
      context: { items: [1, 2, 3] },
      computed: { count: ({ context }) => context.items.length },
      states: {
        idle: {
          effects: [
            ({ computed }) => {
              seen = computed.count
            },
          ],
        },
      },
    })
    expect(seen).toBe(3)
  })

  it('memoizes: the def only runs when its input changes', () => {
    let runs = 0
    const m = createTransitions<
      'idle',
      { n: number; other: number },
      { type: 'bumpOther' | 'read' },
      { double: number }
    >({
      initial: 'idle',
      context: { n: 2, other: 0 },
      computed: {
        double: ({ context }) => {
          runs++
          return context.n * 2
        },
      },
      states: {
        idle: {
          on: {
            bumpOther: {
              actions: [({ context, setContext }) => setContext({ other: context.other + 1 })],
            },
            read: { actions: [({ computed }) => void computed.double] },
          },
        },
      },
    })
    m.send({ type: 'read' }) // first read computes once
    expect(runs).toBe(1)
    m.send({ type: 'read' }) // memoized, n unchanged → no recompute
    expect(runs).toBe(1)
    m.send({ type: 'bumpOther' }) // changed `other`, which `double` does NOT read
    m.send({ type: 'read' })
    expect(runs).toBe(1) // still memoized — double only depends on n
  })

  it('no computed config → params.computed is an empty bag', () => {
    let seen: unknown
    const m = createTransitions<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: { idle: { on: { go: { actions: [({ computed }) => (seen = computed)] } } } },
    })
    m.send({ type: 'go' })
    expect(seen).toEqual({})
  })
})

describe('R7b — computed from computed (chaining)', () => {
  type Ctx = { first: string; last: string }
  type Comp = { fullName: string; greeting: string }

  it('a computed can derive from another computed', () => {
    let seen: string | undefined
    const m = createTransitions<'idle', Ctx, { type: 'read' }, Comp>({
      initial: 'idle',
      context: { first: 'Ada', last: 'Lovelace' },
      computed: {
        fullName: ({ context }) => `${context.first} ${context.last}`,
        greeting: ({ computed }) => `Hi, ${computed.fullName}`,
      },
      states: {
        idle: { on: { read: { actions: [({ computed }) => (seen = computed.greeting)] } } },
      },
    })
    m.send({ type: 'read' })
    expect(seen).toBe('Hi, Ada Lovelace')
  })

  it('an upstream context change propagates through the chain (glitch-free)', () => {
    const seen: string[] = []
    const m = createTransitions<'idle', Ctx, { type: 'rename' | 'read' }, Comp>({
      initial: 'idle',
      context: { first: 'Ada', last: 'Lovelace' },
      computed: {
        fullName: ({ context }) => `${context.first} ${context.last}`,
        greeting: ({ computed }) => `Hi, ${computed.fullName}`,
      },
      states: {
        idle: {
          on: {
            rename: { actions: [({ setContext }) => setContext({ first: 'Grace' })] },
            read: { actions: [({ computed }) => seen.push(computed.greeting)] },
          },
        },
      },
    })
    m.send({ type: 'read' })
    m.send({ type: 'rename' })
    m.send({ type: 'read' })
    expect(seen).toEqual(['Hi, Ada Lovelace', 'Hi, Grace Lovelace'])
  })

  it('forward reference: a def may read a computed defined LATER (lazy)', () => {
    let seen: string | undefined
    const m = createTransitions<
      'idle',
      Ctx,
      { type: 'read' },
      { greeting: string; fullName: string }
    >({
      initial: 'idle',
      context: { first: 'Ada', last: 'Lovelace' },
      computed: {
        // greeting (reads fullName) is defined BEFORE fullName on purpose
        greeting: ({ computed }) => `Hi, ${computed.fullName}`,
        fullName: ({ context }) => `${context.first} ${context.last}`,
      },
      states: {
        idle: { on: { read: { actions: [({ computed }) => (seen = computed.greeting)] } } },
      },
    })
    m.send({ type: 'read' })
    expect(seen).toBe('Hi, Ada Lovelace') // order-independent
  })

  it('multi-level chain recomputes only the affected branch (memoized)', () => {
    let baseRuns = 0
    let derivedRuns = 0
    const m = createTransitions<
      'idle',
      { n: number; unrelated: number },
      { type: 'bumpN' | 'bumpUnrelated' | 'read' },
      { base: number; derived: number }
    >({
      initial: 'idle',
      context: { n: 1, unrelated: 0 },
      computed: {
        base: ({ context }) => {
          baseRuns++
          return context.n * 10
        },
        derived: ({ computed }) => {
          derivedRuns++
          return computed.base + 1
        },
      },
      states: {
        idle: {
          on: {
            bumpN: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] },
            bumpUnrelated: {
              actions: [
                ({ context, setContext }) => setContext({ unrelated: context.unrelated + 1 }),
              ],
            },
            read: { actions: [({ computed }) => void computed.derived] },
          },
        },
      },
    })
    m.send({ type: 'read' }) // base=10, derived=11 — each runs once
    expect([baseRuns, derivedRuns]).toEqual([1, 1])
    m.send({ type: 'bumpUnrelated' }) // neither base nor derived reads `unrelated`
    m.send({ type: 'read' })
    expect([baseRuns, derivedRuns]).toEqual([1, 1]) // fully memoized
    m.send({ type: 'bumpN' }) // base depends on n → whole chain invalidates
    m.send({ type: 'read' })
    expect([baseRuns, derivedRuns]).toEqual([2, 2])
  })
})
