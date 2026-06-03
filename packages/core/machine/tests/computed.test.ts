/**
 * Computed — lazy, memoized derivations of context (and other computeds).
 * Recompute only when a read input changes; available in guard/action/effect
 * params, and surfaced on the machine as `m.computed.x` (a tracked read).
 */
import { effect } from '@preact/signals-core'
import { machine } from '../src'
import { describe, expect, it } from 'vitest'

describe('from context', () => {
  it('derives a value from context, readable in an action', () => {
    let seen: boolean | undefined
    const m = machine<'idle', { items: number[] }, { type: 'check' }, { isEmpty: boolean }>({
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
    const m = machine<'idle', { items: number[] }, { type: 'add' | 'check' }, { isEmpty: boolean }>(
      {
        initial: 'idle',
        context: { items: [] },
        computed: { isEmpty: ({ context }) => context.items.length === 0 },
        states: {
          idle: {
            on: {
              add: {
                actions: [
                  ({ context, setContext }) => setContext({ items: [...context.items, 1] }),
                ],
              },
              check: { actions: [({ computed }) => seen.push(computed.isEmpty)] },
            },
          },
        },
      },
    )
    m.send({ type: 'check' }) // empty → true
    m.send({ type: 'add' })
    m.send({ type: 'check' }) // now has 1 item → false
    expect(seen).toEqual([true, false])
  })

  it('is available to a guard', () => {
    const m = machine<
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

  it('is available to an effect at start', () => {
    let seen: number | undefined
    const m = machine<'idle', { items: number[] }, { type: 'noop' }, { count: number }>({
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
    m.start()
    expect(seen).toBe(3)
  })

  it('memoizes: the def only runs when its input changes', () => {
    let runs = 0
    const m = machine<
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
    const m = machine<'idle', object, { type: 'go' }>({
      initial: 'idle',
      context: {},
      states: { idle: { on: { go: { actions: [({ computed }) => (seen = computed)] } } } },
    })
    m.send({ type: 'go' })
    expect(seen).toEqual({})
  })
})

describe('chaining — computed from computed', () => {
  type Ctx = { first: string; last: string }
  type Comp = { fullName: string; greeting: string }

  it('a computed can derive from another computed', () => {
    let seen: string | undefined
    const m = machine<'idle', Ctx, { type: 'read' }, Comp>({
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
    const m = machine<'idle', Ctx, { type: 'rename' | 'read' }, Comp>({
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
    const m = machine<'idle', Ctx, { type: 'read' }, { greeting: string; fullName: string }>({
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
    const m = machine<
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

describe('surfaced on the machine', () => {
  it('exposes m.computed.x reflecting the current derived value', () => {
    const m = machine<'idle', { items: number[] }, { type: 'add' }, { count: number }>({
      initial: 'idle',
      context: { items: [] },
      computed: { count: ({ context }) => context.items.length },
      states: {
        idle: {
          on: {
            add: {
              actions: [({ context, setContext }) => setContext({ items: [...context.items, 1] })],
            },
          },
        },
      },
    })
    expect(m.computed.count).toBe(0)
    m.send({ type: 'add' })
    expect(m.computed.count).toBe(1)
  })

  it('reading m.computed.x is tracked — a preact effect re-runs on change', () => {
    const m = machine<'idle', { n: number }, { type: 'inc' }, { double: number }>({
      initial: 'idle',
      context: { n: 1 },
      computed: { double: ({ context }) => context.n * 2 },
      states: {
        idle: {
          on: { inc: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })
    const seen: number[] = []
    const dispose = effect(() => {
      seen.push(m.computed.double) // subscribes to the computed signal
    })
    m.send({ type: 'inc' }) // n 1→2 → double 2→4 → effect re-runs
    m.send({ type: 'inc' }) // n 2→3 → double 4→6 → effect re-runs
    dispose()
    m.send({ type: 'inc' }) // disposed → no further pushes
    expect(seen).toEqual([2, 4, 6])
  })

  it('m.computed reflects chained computeds too', () => {
    const m = machine<
      'idle',
      { first: string; last: string },
      { type: 'noop' },
      { full: string; greet: string }
    >({
      initial: 'idle',
      context: { first: 'Ada', last: 'Lovelace' },
      computed: {
        full: ({ context }) => `${context.first} ${context.last}`,
        greet: ({ computed }) => `Hi, ${computed.full}`,
      },
      states: { idle: {} },
    })
    expect(m.computed.full).toBe('Ada Lovelace')
    expect(m.computed.greet).toBe('Hi, Ada Lovelace')
  })
})
