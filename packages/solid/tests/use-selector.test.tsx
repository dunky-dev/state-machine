// @vitest-environment jsdom
// `useSelector` contract: value-deduped accessor (Object.is default, custom
// isEqual), and a slice change wakes only its own reader.
import { createEffect, flush } from 'solid-js'
import { render, renderHook } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act as write, machine, type TransitionConfig } from '@dunky.dev/state-machine'
import { useSelector } from '@dunky.dev/solid-state-machine'

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
    flush() // Solid 2.0 defers signal commits to the microtask queue
    expect(result()).toBe(1)
  })

  it('updates the accessor ONLY when the selected slice changes', () => {
    const m = makeMachine()
    const reads = vi.fn()
    // A tracked reader of the accessor, created inside the hook render so it is
    // owned; the apply phase re-runs only when the signal changes.
    renderHook(() => {
      const result = useSelector(m, () => m.context.a)
      createEffect(() => result(), reads)
    })
    flush() // effects run after the queue flushes
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // selects `a`, `b` changed → no update
    flush()
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'noop' }) // nothing changed → no update
    flush()
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // `a` changed → update
    flush()
    expect(reads).toHaveBeenCalledTimes(2)
  })

  it('defaults to Object.is equality (a re-derived equal value does not update)', () => {
    const m = makeMachine()
    const reads = vi.fn()
    renderHook(() => {
      const result = useSelector(m, () => m.context.a > 0)
      createEffect(() => result(), reads)
    })
    flush()
    expect(reads).toHaveBeenCalledTimes(1)
    m.send({ type: 'incA' }) // false → true (update)
    flush()
    expect(reads).toHaveBeenCalledTimes(2)
    m.send({ type: 'incA' }) // true → true (no update)
    flush()
    expect(reads).toHaveBeenCalledTimes(2)
  })
})

describe('useSelector — function-typed selections', () => {
  // Regression guard for the compute-form seed: Solid 2.0's createSignal
  // treats a function first argument as a compute and CALLS it, so a selected
  // callback passed as a plain value would be invoked and its return value
  // stored. The accessor must hand back the function itself, by identity.
  it('returns a selected function by identity, never invoking it', () => {
    const m = makeMachine()
    const handlers = [vi.fn(() => 'h0'), vi.fn(() => 'h1')]
    const { result } = renderHook(() => useSelector(m, () => handlers[m.context.a]!))
    expect(result()).toBe(handlers[0])

    m.send({ type: 'incA' })
    flush()
    expect(result()).toBe(handlers[1])
    expect(handlers[0]).not.toHaveBeenCalled()
    expect(handlers[1]).not.toHaveBeenCalled()
  })
})

describe('useSelector — custom isEqual for object selections', () => {
  it('uses the provided isEqual to dedup an object selection', () => {
    const m = makeMachine()
    const reads = vi.fn()
    renderHook(() => {
      const result = useSelector(
        m,
        () => ({ a: m.context.a }),
        (x, y) => x.a === y.a,
      )
      createEffect(() => result(), reads)
    })
    flush()
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // selected {a} unchanged → no update
    flush()
    expect(reads).toHaveBeenCalledTimes(1)

    m.send({ type: 'incA' }) // {a} changed → update
    flush()
    expect(reads).toHaveBeenCalledTimes(2)
  })
})

describe('useSelector — subscription follows the owner lifecycle', () => {
  it('stops evaluating the selector once the owner is disposed', () => {
    const m = makeMachine()
    const selector = vi.fn(() => m.context.a)
    const { result, cleanup } = renderHook(() => useSelector(m, selector))
    expect(result()).toBe(0)

    cleanup()
    const evaluations = selector.mock.calls.length
    m.send({ type: 'incA' }) // disposed reader → the machine must not re-evaluate it
    flush()
    expect(selector.mock.calls.length).toBe(evaluations)
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
    flush()
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(1)

    m.send({ type: 'incB' }) // only LeafB's slice changed
    flush()
    expect(aRenders).toHaveBeenCalledTimes(2)
    expect(bRenders).toHaveBeenCalledTimes(2)
  })
})
