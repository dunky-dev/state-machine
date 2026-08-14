// @vitest-environment jsdom
/**
 * `useSelector` — fine-grained leaf subscription. These tests pin the README
 * contract: the selector reads the machine directly, the component re-renders
 * ONLY when the selected value changes (value-deduped, `Object.is` by default,
 * custom `isEqual` for object selections), a fresh per-render selector closure
 * still evaluates its latest form without re-subscribing, and a change to one
 * leaf's slice wakes only that leaf (the O(readers) property).
 */
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act as write, machine, type TransitionConfig } from '@dunky.dev/state-machine'
import { useSelector } from '@dunky.dev/react-state-machine'

type S = 'idle'
interface Ctx {
  a: number
  b: number
}
type Ev = { type: 'incA' } | { type: 'incB' } | { type: 'noop' }

const config: TransitionConfig<S, Ctx, Ev> = {
  initial: 'idle',
  context: { a: 0, b: 0 },
  states: {
    idle: {
      on: {
        // context writes go through setContext (via `act`) so the bus notifies —
        // a raw in-place `context.a++` mutates the value but never wakes subscribers.
        incA: write($ => ({ a: $.context.a + 1 })),
        incB: write($ => ({ b: $.context.b + 1 })),
        noop: () => {},
      },
    },
  },
}

function makeMachine() {
  const m = machine(config)
  m.start()
  return m
}

afterEach(() => vi.clearAllMocks())

describe('useSelector — value-deduped re-renders', () => {
  it('reads the machine directly and reflects the selected value', () => {
    const m = makeMachine()
    let seen: number | undefined
    function Comp() {
      seen = useSelector(m, () => m.context.a)
      return null
    }
    render(<Comp />)
    expect(seen).toBe(0)
    act(() => m.send({ type: 'incA' }))
    expect(seen).toBe(1)
  })

  it('re-renders ONLY when the selected slice changes (not on every machine change)', () => {
    const m = makeMachine()
    const renders = vi.fn()
    function Comp() {
      const a = useSelector(m, () => m.context.a)
      renders()
      return <span>{a}</span>
    }
    render(<Comp />)
    expect(renders).toHaveBeenCalledTimes(1)

    act(() => m.send({ type: 'incB' })) // selects `a`, `b` changed → no re-render
    expect(renders).toHaveBeenCalledTimes(1)

    act(() => m.send({ type: 'noop' })) // nothing changed → no re-render
    expect(renders).toHaveBeenCalledTimes(1)

    act(() => m.send({ type: 'incA' })) // `a` changed → re-render
    expect(renders).toHaveBeenCalledTimes(2)
  })

  it('defaults to Object.is equality (a re-derived equal value does not re-render)', () => {
    const m = makeMachine()
    const renders = vi.fn()
    function Comp() {
      useSelector(m, () => m.context.a > 0) // boolean: flips only at 0→1
      renders()
      return null
    }
    render(<Comp />)
    expect(renders).toHaveBeenCalledTimes(1)
    act(() => m.send({ type: 'incA' })) // false → true (re-render)
    expect(renders).toHaveBeenCalledTimes(2)
    act(() => m.send({ type: 'incA' })) // true → true (no re-render)
    expect(renders).toHaveBeenCalledTimes(2)
  })
})

describe('useSelector — custom isEqual for object selections', () => {
  it('uses the provided isEqual to dedup an object selection', () => {
    const m = makeMachine()
    const renders = vi.fn()
    function Comp() {
      useSelector(
        m,
        () => ({ a: m.context.a }),
        (x, y) => x.a === y.a,
      )
      renders()
      return null
    }
    render(<Comp />)
    expect(renders).toHaveBeenCalledTimes(1)

    act(() => m.send({ type: 'incB' })) // selected {a} unchanged → no re-render
    expect(renders).toHaveBeenCalledTimes(1)

    act(() => m.send({ type: 'incA' })) // {a} changed → re-render
    expect(renders).toHaveBeenCalledTimes(2)
  })

  it('a custom isEqual makes getSnapshot referentially stable across re-evaluations (no loop)', () => {
    // Regression guard: an object selection WITH isEqual must hold a stable
    // identity between real changes. Without the getSnapshot cache, useSync
    // ExternalStore re-evaluates, sees a fresh `{...}` each call, and loops with
    // "Maximum update depth exceeded". This asserts the cache holds.
    const m = makeMachine()
    let last: { a: number } | undefined
    function Comp() {
      last = useSelector(
        m,
        () => ({ a: m.context.a }),
        (x, y) => x.a === y.a,
      )
      return null
    }
    expect(() => render(<Comp />)).not.toThrow()
    const firstIdentity = last
    act(() => m.send({ type: 'incB' })) // unrelated change: same object identity
    expect(last).toBe(firstIdentity)
    act(() => m.send({ type: 'incA' })) // real change: new value
    expect(last).not.toBe(firstIdentity)
    expect(last).toEqual({ a: 1 })
  })
})

describe('useSelector — fresh per-render selector closure', () => {
  it('evaluates the LATEST selector closure (closing over a changing prop) without re-subscribing', () => {
    const m = makeMachine()
    let seen: boolean | undefined
    function Comp({ target }: { target: number }) {
      seen = useSelector(m, () => m.context.a === target)
      return null
    }
    const { rerender } = render(<Comp target={0} />)
    expect(seen).toBe(true) // a=0 === target 0

    rerender(<Comp target={1} />) // new closure; a still 0 → 0 === 1 is false
    expect(seen).toBe(false)

    act(() => m.send({ type: 'incA' })) // a → 1; latest closure compares to target 1
    expect(seen).toBe(true)
  })
})

describe('useSelector — O(readers): a slice change wakes only its reader', () => {
  it('re-renders only the leaf whose selected slice changed', () => {
    const m = makeMachine()
    const aRenders = vi.fn()
    const bRenders = vi.fn()
    function LeafA() {
      useSelector(m, () => m.context.a)
      aRenders()
      return null
    }
    function LeafB() {
      useSelector(m, () => m.context.b)
      bRenders()
      return null
    }
    render(
      <>
        <LeafA />
        <LeafB />
      </>,
    )
    expect(aRenders).toHaveBeenCalledTimes(1)
    expect(bRenders).toHaveBeenCalledTimes(1)

    act(() => m.send({ type: 'incA' })) // only LeafA's slice changed
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(1)

    act(() => m.send({ type: 'incB' })) // only LeafB's slice changed
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(2)
  })
})
