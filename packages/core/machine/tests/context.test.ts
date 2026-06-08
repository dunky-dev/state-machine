/**
 * Context — the machine's reactive data, a plain object behind one batched
 * write (`setContext`). Reads are plain property access; a real write notifies
 * (so observers re-evaluate), a no-op write does not. Copy-on-write: the initial
 * object is shared until the first write, then privately owned (never mutates the
 * input).
 *
 * Fine-grained "only the readers of the changed field wake" is a property of
 * `select` (value-deduped) — verified in subscribe.test.ts — not of createContext
 * itself, which is now a plain store + a coarse notify.
 */
import { describe, expect, it, vi } from 'vitest'
import { createContext } from '../src/context'

describe('createContext', () => {
  it('reads fields by plain property access', () => {
    const { context } = createContext({ a: 1, b: 'x' })
    expect(context.a).toBe(1)
    expect(context.b).toBe('x')
  })

  it('setContext updates fields; reads reflect the new value', () => {
    const { context, setContext } = createContext({ a: 1, b: 2 })
    setContext({ a: 10 })
    expect(context.a).toBe(10)
    expect(context.b).toBe(2) // untouched
  })

  it('a real write calls notify; a no-op write does not', () => {
    const notify = vi.fn()
    const { setContext } = createContext({ a: 0, b: 0 }, notify)
    setContext({ a: 1 })
    expect(notify).toHaveBeenCalledTimes(1)
    setContext({ a: 1 }) // same value → no notify (Object.is dedup)
    expect(notify).toHaveBeenCalledTimes(1)
    setContext({ b: 2 })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('a multi-field setContext notifies once (batched)', () => {
    const notify = vi.fn()
    const { context, setContext } = createContext({ a: 0, b: 0 }, notify)
    setContext({ a: 1, b: 1 }) // two fields, one batch
    expect(notify).toHaveBeenCalledTimes(1) // exactly once, not twice
    expect(context.a).toBe(1)
    expect(context.b).toBe(1)
  })

  it('copy-on-write: never mutates the initial object', () => {
    const initial = { a: 0, b: 0 }
    const { context, setContext } = createContext(initial)
    setContext({ a: 1 })
    expect(initial.a).toBe(0) // input untouched (copy-on-write)
    expect(context.a).toBe(1) // reads reflect the owned copy
  })

  it('reads stay valid after destructuring across writes', () => {
    const { context, setContext } = createContext({ a: 0 })
    setContext({ a: 1 })
    expect(context.a).toBe(1) // destructured `context` is a stable wrapper, not stale
  })

  it('keys are enumerable (spreads / Object.keys see them)', () => {
    const { context } = createContext({ a: 1, b: 2 })
    expect(Object.keys(context).sort()).toEqual(['a', 'b'])
    expect({ ...context }).toEqual({ a: 1, b: 2 })
  })
})
