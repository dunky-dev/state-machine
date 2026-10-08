/**
 * Computed — lazy, memoized derivations of context (and other computeds).
 * Recompute only when a read input changes; available in guard/action/effect
 * params, and surfaced on the machine as `m.computed.x` (a tracked read).
 */
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

  it('a computed selection fires on change and dedups (value-gated)', () => {
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
    const off = m.select.computed('double').subscribe(v => seen.push(v))
    m.send({ type: 'inc' }) // n 1→2 → double 2→4 → fires
    m.send({ type: 'inc' }) // n 2→3 → double 4→6 → fires
    off()
    m.send({ type: 'inc' }) // unsubscribed → no further pushes
    expect(seen).toEqual([4, 6]) // fires on change (does not fire on subscribe)
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

// Read-key dependency tracking records exactly the keys a computed read on its
// last run. With a conditional read, the untaken branch's field isn't a dep — so
// changing it alone keeps the computed cached. Correct as long as the PREDICATE
// field is read every run (it is), which re-tracks deps when the branch flips.
describe('conditional (dynamic) dependencies', () => {
  type Ctx = { useDiscount: boolean; price: number; discount: number }

  const make = () => {
    let runs = 0
    const m = machine<'idle', Ctx, { type: 'set'; patch: Partial<Ctx> }, { total: number }>({
      initial: 'idle',
      context: { useDiscount: false, price: 100, discount: 10 },
      computed: {
        total: ({ context }) => {
          runs++
          return context.useDiscount ? context.price - context.discount : context.price
        },
      },
      states: {
        idle: { on: { set: { actions: [({ event, setContext }) => setContext(event.patch)] } } },
      },
    })
    return { m, runs: () => runs }
  }

  it('the untaken branch field is not a dependency (stays cached)', () => {
    const { m, runs } = make()
    expect(m.computed.total).toBe(100) // discount path NOT read
    expect(runs()).toBe(1)
    m.send({ type: 'set', patch: { discount: 50 } }) // discount unused on this branch
    expect(m.computed.total).toBe(100) // still cached — no recompute
    expect(runs()).toBe(1)
  })

  it('flipping the predicate re-tracks: the newly-read field becomes a dep', () => {
    const { m, runs } = make()
    expect(m.computed.total).toBe(100) // runs=1, deps: {useDiscount, price}
    m.send({ type: 'set', patch: { useDiscount: true } }) // predicate changed → recompute
    expect(m.computed.total).toBe(90) // 100 - 10; now reads discount too
    expect(runs()).toBe(2)
    m.send({ type: 'set', patch: { discount: 30 } }) // discount IS a dep now → recompute
    expect(m.computed.total).toBe(70)
    expect(runs()).toBe(3)
  })
})

describe('from state', () => {
  // A computed that reads the lifecycle `state` (not just context). The state
  // is a tracked dependency: a transition recomputes it, but an unrelated
  // context write does not.
  const make = () => {
    let runs = 0
    const m = machine<
      'idle' | 'busy' | 'done',
      { note: string },
      { type: 'go' } | { type: 'finish' } | { type: 'setNote'; note: string },
      { isBusy: boolean; label: string }
    >({
      initial: 'idle',
      context: { note: '' },
      computed: {
        isBusy: ({ state }) => state === 'busy',
        label: ({ state }) => {
          runs++
          return `state=${state}`
        },
      },
      states: {
        idle: { on: { go: { target: 'busy' } } },
        busy: { on: { finish: { target: 'done' } } },
        done: {},
      },
      on: {
        setNote: { actions: [({ setContext, event }) => setContext({ note: event.note })] },
      },
    })
    m.start()
    return { m, runs: () => runs }
  }

  it('reads the current state', () => {
    const { m } = make()
    expect(m.computed.isBusy).toBe(false) // idle
    expect(m.computed.label).toBe('state=idle')
  })

  it('a transition invalidates a state-reading computed', () => {
    const { m } = make()
    expect(m.computed.isBusy).toBe(false)
    m.send({ type: 'go' }) // → busy
    expect(m.computed.isBusy).toBe(true)
    expect(m.computed.label).toBe('state=busy')
    m.send({ type: 'finish' }) // → done
    expect(m.computed.isBusy).toBe(false)
    expect(m.computed.label).toBe('state=done')
  })

  it('an unrelated context write does NOT recompute a state-only computed', () => {
    const { m, runs } = make()
    expect(m.computed.label).toBe('state=idle') // runs=1
    expect(runs()).toBe(1)
    m.send({ type: 'setNote', note: 'hi' }) // context changed, state did not
    expect(m.computed.label).toBe('state=idle') // cached — no recompute
    expect(runs()).toBe(1)
    m.send({ type: 'go' }) // state changed → recompute
    expect(m.computed.label).toBe('state=busy')
    expect(runs()).toBe(2)
  })
})
