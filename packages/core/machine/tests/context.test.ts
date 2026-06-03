/**
 * Context — reactive data cells.
 *
 * Pins the decided shape: plain tracked reads (`context.field`) + one
 * explicit batched write (`setContext({ field })`), signal-backed per cell.
 */
import { effect } from '@preact/signals-core'
import { describe, expect, it } from 'vitest'
import { createContext } from '../src'

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

  it('reads are tracked — a reader re-runs only when ITS field changes', () => {
    const { context, setContext } = createContext({ a: 0, b: 0 })
    let aRuns = 0
    let bRuns = 0
    // initial effect run counts once each
    effect(() => {
      context.a
      aRuns++
    })
    effect(() => {
      context.b
      bRuns++
    })
    expect(aRuns).toBe(1)
    expect(bRuns).toBe(1)

    setContext({ a: 1 })
    expect(aRuns).toBe(2) // a's reader re-ran
    expect(bRuns).toBe(1) // b's reader did NOT — fine-grained

    setContext({ b: 1 })
    expect(aRuns).toBe(2)
    expect(bRuns).toBe(2)
  })

  it('no-op writes do not notify (signal Object.is dedup)', () => {
    const { context, setContext } = createContext({ a: 0 })
    let runs = 0
    effect(() => {
      context.a
      runs++
    })
    expect(runs).toBe(1)
    setContext({ a: 0 }) // same value
    expect(runs).toBe(1) // no re-run
  })

  it('a multi-field setContext wakes each reader at most once (batched)', () => {
    const { context, setContext } = createContext({ a: 0, b: 0 })
    let aRuns = 0
    effect(() => {
      context.a
      context.b
      aRuns++
    })
    expect(aRuns).toBe(1)
    setContext({ a: 1, b: 1 }) // two fields, one batch
    expect(aRuns).toBe(2) // exactly once, not twice
  })

  it('keys are enumerable (spreads / Object.keys see them)', () => {
    const { context } = createContext({ a: 1, b: 2 })
    expect(Object.keys(context).sort()).toEqual(['a', 'b'])
    expect({ ...context }).toEqual({ a: 1, b: 2 })
  })
})
