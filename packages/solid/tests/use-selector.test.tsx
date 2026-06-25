// @vitest-environment jsdom
/**
 * `useSelector` — fine-grained leaf subscription. These tests pin the contract:
 * the selector reads the machine directly, the returned accessor updates ONLY
 * when the selected value changes (value-deduped, Object.is by default, custom
 * isEqual for object selections), and a change to one leaf's slice wakes only
 * that leaf's accessor (the O(readers) property).
 */
import { createEffect } from 'solid-js'
import { render, renderHook } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act as write, machine, type TransitionConfig } from '@dunky.dev/state-machine'
import { useSelector } from '../src'

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

describe('useSelector — value-deduped accessor', () => {
  it('reads the machine directly and reflects the selected value', () => {
    const m = makeMachine()
    const { result } = renderHook(() => useSelector(m, () => m.context.a))
    expect(result()).toBe(0)
    m.send({ type: 'incA' })
    expect(result()).toBe(1)
  })

  it('updates the accessor ONLY when the selected slice changes', () => {
    const m = makeMachine()
    const reads = vi.fn()
    const { result } = renderHook(() => useSelector(m, () => m.context.a))
    // A tracked reader of the accessor; it re-runs only when the signal changes.
    createEffect(() => reads(result()))
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // selects `a`, `b` changed → no update
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'noop' }) // nothing changed → no update
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // `a` changed → update
    expect(reads).toHaveBeenCalledTimes(2)
  })

  it('defaults to Object.is equality (a re-derived equal value does not update)', () => {
    const m = makeMachine()
    const reads = vi.fn()
    const { result } = renderHook(() => useSelector(m, () => m.context.a > 0))
    createEffect(() => reads(result()))
    expect(reads).toHaveBeenCalledTimes(1)
    m.send({ type: 'incA' }) // false → true (update)
    expect(reads).toHaveBeenCalledTimes(2)
    m.send({ type: 'incA' }) // true → true (no update)
    expect(reads).toHaveBeenCalledTimes(2)
  })
})

describe('useSelector — custom isEqual for object selections', () => {
  it('uses the provided isEqual to dedup an object selection', () => {
    const m = makeMachine()
    const reads = vi.fn()
    const { result } = renderHook(() =>
      useSelector(
        m,
        () => ({ a: m.context.a }),
        (x, y) => x.a === y.a,
      ),
    )
    createEffect(() => reads(result()))
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // selected {a} unchanged → no update
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // {a} changed → update
    expect(reads).toHaveBeenCalledTimes(2)
  })
})

describe('useSelector — O(readers): a slice change wakes only its reader', () => {
  it('updates only the leaf whose selected slice changed', () => {
    const m = makeMachine()
    const aRenders = vi.fn()
    const bRenders = vi.fn()
    function LeafA() {
      const a = useSelector(m, () => m.context.a)
      return <span>{(aRenders(), a())}</span>
    }
    function LeafB() {
      const b = useSelector(m, () => m.context.b)
      return <span>{(bRenders(), b())}</span>
    }
    render(() => (
      <>
        <LeafA />
        <LeafB />
      </>
    ))
    expect(aRenders).toHaveBeenCalledTimes(1)
    expect(bRenders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // only LeafA's slice changed
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // only LeafB's slice changed
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(2)
  })
})
