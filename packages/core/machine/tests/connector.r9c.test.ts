/**
 * Round 9c — connector: live subscribable snapshot (C/A/A).
 *
 * Pins the three snapshot gotchas + props reactivity:
 *  - snapshot identity is STABLE across reads when nothing changed
 *    (no useSyncExternalStore infinite loop), and changes when inputs change;
 *  - snapshot reads LIVE machine state (no tearing / stale closure);
 *  - props are a reactive input — setProps recomputes + wakes;
 *  - subscribe is coarse (fires on any change), passive (bridge owns timing);
 *  - select is forwarded for per-field (canvas/Lit) consumption.
 */
import { describe, expect, it, vi } from 'vitest'
import { connector, createTransitions } from '../src/machine'

type Ctx = { count: number }
type Ev = { type: 'inc' }
type Props = { label: string }

const setup = (initialProps: Props = { label: 'hi' }) => {
  const m = createTransitions<'a' | 'b', Ctx, Ev | { type: 'toB' }>({
    initial: 'a',
    context: { count: 0 },
    // `inc` is any-state so it works in both a and b; `toB` lives on a.
    on: {
      inc: { actions: [({ context, setContext }) => setContext({ count: context.count + 1 })] },
    },
    states: {
      a: { on: { toB: { target: 'b' } } },
      b: {},
    },
  })
  // connect builds a fresh api object from the snapshot.
  const connect = (s: {
    state: string
    context: Ctx
    props: Props
    send: (e: Ev | { type: 'toB' }) => void
  }) => ({
    state: s.state,
    count: s.context.count,
    label: s.props.label,
    inc: () => s.send({ type: 'inc' }),
  })
  const c = connector(m, connect, initialProps)
  return { m, c }
}

describe('R9c — connector', () => {
  it('snapshot reflects connect output', () => {
    const { c } = setup()
    expect(c.snapshot.state).toBe('a')
    expect(c.snapshot.count).toBe(0)
    expect(c.snapshot.label).toBe('hi')
  })

  it('snapshot identity is STABLE across reads when nothing changed', () => {
    const { c } = setup()
    const first = c.snapshot
    const second = c.snapshot
    expect(first).toBe(second) // Object.is-equal → no useSyncExternalStore loop
  })

  it('snapshot identity CHANGES after a context change', () => {
    const { m, c } = setup()
    const before = c.snapshot
    m.send({ type: 'inc' })
    const after = c.snapshot
    expect(after).not.toBe(before)
    expect(after.count).toBe(1)
  })

  it('reads live state — no tearing (snapshot after a transition is current)', () => {
    const { m, c } = setup()
    m.send({ type: 'toB' })
    expect(c.snapshot.state).toBe('b')
  })

  it('subscribe fires on any change; not on subscribe; unsub stops it', () => {
    const { m, c } = setup()
    const fn = vi.fn()
    const unsub = c.subscribe(fn)
    expect(fn).not.toHaveBeenCalled()
    m.send({ type: 'inc' })
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
    m.send({ type: 'inc' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('props are reactive — setProps recomputes the snapshot and wakes subscribers', () => {
    const { c } = setup({ label: 'one' })
    const fn = vi.fn()
    c.subscribe(fn)
    expect(c.snapshot.label).toBe('one')
    c.setProps({ label: 'two' })
    expect(c.snapshot.label).toBe('two') // recomputed
    expect(fn).toHaveBeenCalledTimes(1) // woke subscribers
  })

  it('drives a useSyncExternalStore-style loop without re-render churn', () => {
    const { m, c } = setup()
    // simulate uSES: read snapshot, subscribe, re-read on notify, compare identity
    let renders = 0
    const read = () => {
      renders++
      return c.snapshot
    }
    let snap = read()
    c.subscribe(() => {
      const next = read()
      expect(next).not.toBe(snap) // a notify always carries a new identity
      snap = next
    })
    const r0 = renders
    // reading the snapshot repeatedly without a change must be identity-stable
    expect(c.snapshot).toBe(c.snapshot)
    expect(renders).toBe(r0) // c.snapshot getter alone didn't force a "render"
    m.send({ type: 'inc' }) // one real change → one notify → one re-read
    expect(renders).toBe(r0 + 1)
  })

  it('forwards select for per-field (canvas/Lit) consumption', () => {
    const { m, c } = setup()
    const count = c.select.context('count')
    const fn = vi.fn()
    count.subscribe(fn)
    m.send({ type: 'toB' }) // state changed, not count → per-field selection silent
    expect(fn).not.toHaveBeenCalled()
    m.send({ type: 'inc' }) // count 0→1 → fires
    expect(fn).toHaveBeenLastCalledWith(1)
  })
})
