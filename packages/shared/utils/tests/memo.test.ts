import { describe, expect, it, vi } from 'vitest'
import { memo } from '../src/utils/memo'

describe('memo', () => {
  it('returns the same result for identical args', () => {
    const fn = vi.fn((a: number, b: number) => a + b)
    const m = memo(fn)

    expect(m(1, 2)).toBe(3)
    expect(m(1, 2)).toBe(3)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('recomputes for different args', () => {
    const fn = vi.fn((a: number, b: number) => a + b)
    const m = memo(fn)

    m(1, 2)
    m(1, 3)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('works with object args (referential identity)', () => {
    const fn = vi.fn((a: { x: number }) => a.x * 2)
    const m = memo(fn)

    const arg = { x: 5 }
    expect(m(arg)).toBe(10)
    expect(m(arg)).toBe(10)
    expect(fn).toHaveBeenCalledTimes(1)

    // Structurally identical but new reference → recomputes.
    expect(m({ x: 5 })).toBe(10)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('interns primitives so caching survives across calls', () => {
    const fn = vi.fn((a: string, b: number) => `${a}:${b}`)
    const m = memo(fn)

    expect(m('hello', 1)).toBe('hello:1')
    expect(m('hello', 1)).toBe('hello:1')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('handles null and undefined args', () => {
    const fn = vi.fn((a: unknown) => (a === null ? 'null' : 'other'))
    const m = memo(fn)

    expect(m(null)).toBe('null')
    expect(m(null)).toBe('null')
    expect(m(undefined)).toBe('other')
    expect(m(undefined)).toBe('other')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('caches per-arg-tuple independently', () => {
    const fn = vi.fn((a: number, b: number) => a * b)
    const m = memo(fn)

    m(2, 3)
    m(3, 2)
    expect(fn).toHaveBeenCalledTimes(2)

    m(2, 3)
    m(3, 2)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
