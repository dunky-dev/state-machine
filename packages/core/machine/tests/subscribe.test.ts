/**
 * Subscriptions — coarse `subscribe` (wake on any change) and the fine-grained
 * `select` surface: select(fn), and the typed named scopes
 * select.context/.computed/.state. Selections fire only when the selected value
 * changes (Object.is default + optional equals); none fire on subscribe.
 */
import { machine } from '../src'
import { describe, expect, it, vi } from 'vitest'

describe('coarse subscribe', () => {
  it('does NOT fire on subscribe; fires on a context change', () => {
    const m = machine<'idle', { n: number }, { type: 'inc' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: { inc: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })
    const fn = vi.fn()
    m.subscribe(fn)
    expect(fn).not.toHaveBeenCalled() // no fire-on-subscribe
    m.send({ type: 'inc' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fires on a state change', () => {
    const m = machine<'a' | 'b', object, { type: 'toB' }>({
      initial: 'a',
      context: {},
      states: { a: { on: { toB: { target: 'b' } } }, b: {} },
    })
    const fn = vi.fn()
    m.subscribe(fn)
    m.send({ type: 'toB' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops further notifications', () => {
    const m = machine<'idle', { n: number }, { type: 'inc' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: { inc: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })
    const fn = vi.fn()
    const unsub = m.subscribe(fn)
    m.send({ type: 'inc' })
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
    m.send({ type: 'inc' })
    expect(fn).toHaveBeenCalledTimes(1) // no more after unsub
  })

  it('multiple subscribers all fire', () => {
    const m = machine<'idle', { n: number }, { type: 'inc' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: { inc: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })
    const a = vi.fn()
    const b = vi.fn()
    m.subscribe(a)
    m.subscribe(b)
    m.send({ type: 'inc' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('a batched multi-field write coalesces to a single notification', () => {
    const m = machine<'idle', { a: number; b: number }, { type: 'both' }>({
      initial: 'idle',
      context: { a: 0, b: 0 },
      states: {
        idle: { on: { both: { actions: [({ setContext }) => setContext({ a: 1, b: 1 })] } } },
      },
    })
    const fn = vi.fn()
    m.subscribe(fn)
    m.send({ type: 'both' }) // setContext batches both cells → one fire
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a no-op write (unchanged value) does not fire', () => {
    const m = machine<'idle', { n: number }, { type: 'same' }>({
      initial: 'idle',
      context: { n: 5 },
      states: { idle: { on: { same: { actions: [({ setContext }) => setContext({ n: 5 })] } } } },
    })
    const fn = vi.fn()
    m.subscribe(fn)
    m.send({ type: 'same' }) // n 5→5, Object.is equal → cell doesn't change → no fire
    expect(fn).not.toHaveBeenCalled()
  })
})

const counter = () =>
  machine<'idle', { items: number[] }, { type: 'add' | 'noop' }>({
    initial: 'idle',
    context: { items: [] },
    states: {
      idle: {
        on: {
          add: {
            actions: [({ context, setContext }) => setContext({ items: [...context.items, 1] })],
          },
          noop: { actions: [() => {}] },
        },
      },
    },
  })

describe('select(fn) — function form', () => {
  it('.value reads the current selected value', () => {
    const m = counter()
    const len = m.select(() => m.context.items.length)
    expect(len.value).toBe(0)
    m.send({ type: 'add' })
    expect(len.value).toBe(1)
  })

  it('subscribe fires listener(value) on a selected-value change, not on subscribe', () => {
    const m = counter()
    const len = m.select(() => m.context.items.length)
    const fn = vi.fn()
    len.subscribe(fn)
    expect(fn).not.toHaveBeenCalled() // no fire-on-subscribe
    m.send({ type: 'add' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1) // receives the new selected value
  })

  it('value-dedup: a context change that does NOT change the selected value is silent', () => {
    const m = counter()
    const isEmpty = m.select(() => m.context.items.length === 0)
    const fn = vi.fn()
    isEmpty.subscribe(fn)
    m.send({ type: 'add' }) // 0→1 item: isEmpty true→false → FIRES
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(false)
    m.send({ type: 'add' }) // 1→2 items: isEmpty false→false → unchanged → SILENT
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops notifications', () => {
    const m = counter()
    const len = m.select(() => m.context.items.length)
    const fn = vi.fn()
    const unsub = len.subscribe(fn)
    m.send({ type: 'add' })
    unsub()
    m.send({ type: 'add' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a composite selection uses optional equals to dedup structurally', () => {
    const m = machine<
      'idle',
      { x: number; y: number; other: number },
      { type: 'moveX' | 'bumpOther' }
    >({
      initial: 'idle',
      context: { x: 0, y: 0, other: 0 },
      states: {
        idle: {
          on: {
            moveX: { actions: [({ context, setContext }) => setContext({ x: context.x + 1 })] },
            bumpOther: {
              actions: [({ context, setContext }) => setContext({ other: context.other + 1 })],
            },
          },
        },
      },
    })
    const pos = m.select(() => ({ x: m.context.x, y: m.context.y }))
    const shallow = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      a.x === b.x && a.y === b.y
    const fn = vi.fn()
    pos.subscribe(fn, shallow)
    m.send({ type: 'bumpOther' }) // pos selector doesn't read `other` → not re-run → silent
    expect(fn).not.toHaveBeenCalled()
    m.send({ type: 'moveX' }) // x changes → {x,y} differs by `shallow` → FIRES
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith({ x: 1, y: 0 })
  })

  it('without equals, a fresh-object selector fires every change (Object.is)', () => {
    const m = counter()
    const obj = m.select(() => ({ len: m.context.items.length }))
    const fn = vi.fn()
    obj.subscribe(fn) // default Object.is: new object each run is never ===
    m.send({ type: 'add' })
    expect(fn).toHaveBeenCalledTimes(1) // fires (different object identity)
  })

  it('.value reads the current selected value on demand', () => {
    const m = counter()
    const len = m.select(() => m.context.items.length)
    expect(len.value).toBe(0)
    m.send({ type: 'add' })
    expect(len.value).toBe(1) // reflects the latest value when read
    m.send({ type: 'add' })
    expect(len.value).toBe(2)
  })
})

describe('select.context / .computed / .state — named scopes', () => {
  it('select.context(key) selects one field with the exact value type', () => {
    const m = machine<'idle', { x: number; label: string }, { type: 'moveX' | 'moveY' }>({
      initial: 'idle',
      context: { x: 0, label: 'a' },
      states: {
        idle: {
          on: {
            moveX: { actions: [({ context, setContext }) => setContext({ x: context.x + 1 })] },
            moveY: { actions: [({ setContext }) => setContext({ label: 'b' })] },
          },
        },
      },
    })
    const x = m.select.context('x')
    const xv: number = x.value // type: number
    expect(xv).toBe(0)

    const fn = vi.fn()
    x.subscribe(fn)
    m.send({ type: 'moveY' }) // changed `label`, not `x` → x selection silent
    expect(fn).not.toHaveBeenCalled()
    m.send({ type: 'moveX' }) // x 0→1 → fires
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1)
  })

  it('select.computed(key) selects a derived value', () => {
    const m = machine<'idle', { items: number[] }, { type: 'add' }, { isEmpty: boolean }>({
      initial: 'idle',
      context: { items: [] },
      computed: { isEmpty: ({ context }) => context.items.length === 0 },
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
    const isEmpty = m.select.computed('isEmpty')
    const v: boolean = isEmpty.value // type: boolean
    expect(v).toBe(true)

    const fn = vi.fn()
    isEmpty.subscribe(fn)
    m.send({ type: 'add' }) // true→false → fires
    expect(fn).toHaveBeenLastCalledWith(false)
    m.send({ type: 'add' }) // false→false → silent (value-dedup)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('select.state() selects the state string and fires on transitions', () => {
    const m = machine<'a' | 'b' | 'c', object, { type: 'next' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { next: { target: 'b' } } },
        b: { on: { next: { target: 'c' } } },
        c: {},
      },
    })
    const state = m.select.state()
    const sv: 'a' | 'b' | 'c' = state.value // type: the State union
    expect(sv).toBe('a')

    const fn = vi.fn()
    state.subscribe(fn)
    m.send({ type: 'next' })
    expect(fn).toHaveBeenLastCalledWith('b')
    m.send({ type: 'next' })
    expect(fn).toHaveBeenLastCalledWith('c')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('select(fn) function form still works alongside the scope methods', () => {
    const m = machine<'idle', { a: number; b: number }, { type: 'go' }>({
      initial: 'idle',
      context: { a: 1, b: 2 },
      states: {
        idle: {
          on: { go: { actions: [({ context, setContext }) => setContext({ a: context.a + 1 })] } },
        },
      },
    })
    const sum = m.select(() => m.context.a + m.context.b)
    expect(sum.value).toBe(3)
    const fn = vi.fn()
    sum.subscribe(fn)
    m.send({ type: 'go' }) // a 1→2 → sum 3→4
    expect(fn).toHaveBeenLastCalledWith(4)
  })
})

// The bus iterates a stable snapshot, so a listener that mutates the listener set
// mid-notify affects the NEXT notify, not the in-flight pass.
describe('reentrancy — subscribing/unsubscribing during a notify', () => {
  const counter = () =>
    machine<'idle', { n: number }, { type: 'inc' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: { inc: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })

  it('a listener added during a notify does NOT fire on that same change', () => {
    const m = counter()
    const late = vi.fn()
    let added = false
    m.subscribe(() => {
      if (!added) {
        added = true
        m.subscribe(late) // subscribe mid-notify
      }
    })
    m.send({ type: 'inc' }) // first change: adds `late`, but `late` must not fire now
    expect(late).not.toHaveBeenCalled()
    m.send({ type: 'inc' }) // next change: `late` is in the snapshot → fires
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('a listener can unsubscribe another mid-notify without skipping the pass', () => {
    const m = counter()
    const calls: string[] = []
    let offB = () => {}
    m.subscribe(() => {
      calls.push('a')
      offB() // remove B during the notify
    })
    offB = m.subscribe(() => calls.push('b'))
    m.send({ type: 'inc' })
    // both A and B were in the snapshot when this notify started, so both ran;
    // B is gone for the NEXT notify.
    expect(calls).toEqual(['a', 'b'])
    calls.length = 0
    m.send({ type: 'inc' })
    expect(calls).toEqual(['a']) // B unsubscribed
  })
})
