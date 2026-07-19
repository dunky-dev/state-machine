import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { mergeProps } from '@dunky.dev/state-machine-utils'

describe('mergeProps', () => {
  it('returns the library bag when consumer is undefined', () => {
    const lib = { id: 'a', role: 'button' }
    expect(mergeProps(undefined, lib)).toBe(lib)
  })

  it('library wins on plain key conflicts', () => {
    const out = mergeProps({ id: 'consumer', role: 'consumer-role' }, { id: 'lib' })
    expect(out.id).toBe('lib')
    expect(out.role).toBe('consumer-role')
  })

  it('passes consumer-only keys through untouched', () => {
    const out = mergeProps({ 'data-testid': 'mine' }, { id: 'x' })
    expect(out['data-testid']).toBe('mine')
    expect(out.id).toBe('x')
  })

  it('composes overlapping on* handlers — consumer then library', () => {
    const order: string[] = []
    const consumer = () => order.push('consumer')
    const library = () => order.push('library')
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as () => void)()
    expect(order).toEqual(['consumer', 'library'])
  })

  it('skips the library handler when consumer event is defaultPrevented', () => {
    const library = vi.fn()
    const consumer = (e: { defaultPrevented: boolean }) => {
      e.defaultPrevented = true
    }
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: false })
    expect(library).not.toHaveBeenCalled()
  })

  it('runs the library handler when consumer event allows default', () => {
    const library = vi.fn()
    const consumer = vi.fn()
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).toHaveBeenCalledOnce()
  })

  it('only composes handlers when BOTH sides are functions', () => {
    const library = vi.fn()
    // consumer has no onClick; library is just assigned through.
    const merged = mergeProps({ id: 'a' }, { onClick: library })
    expect(merged.onClick).toBe(library)
  })

  it('treats `onClick` as a handler but not arbitrary `on*` strings', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    // onClick fired both
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalled()
    expect(library).toHaveBeenCalled()
  })

  it('does NOT special-case `style` (substrate-specific)', () => {
    const consumerStyle = { color: 'red' }
    const libStyle = { color: 'blue' }
    const out = mergeProps({ style: consumerStyle }, { style: libStyle })
    // library wins, no array wrapping.
    expect(out.style).toBe(libStyle)
  })

  it('does NOT special-case `className` (substrate-specific)', () => {
    const out = mergeProps({ className: 'a' }, { className: 'b' })
    // library wins, no concatenation.
    expect(out.className).toBe('b')
  })

  it('returns a fresh object — does not mutate the consumer bag', () => {
    const consumer = { id: 'a', onClick: () => {} }
    const merged = mergeProps(consumer, { id: 'b' })
    expect(merged).not.toBe(consumer)
    expect(consumer.id).toBe('a')
  })
})

describe('mergeProps typing', () => {
  it('accepts a typed consumer interface and preserves its type', () => {
    // An interface without an index signature — the shape every framework's
    // prop types have. Must be accepted and returned as-is, cast-free.
    interface ButtonLikeProps {
      id?: string
      onClick?: (event: { defaultPrevented: boolean }) => void
    }
    const consumer: ButtonLikeProps = { id: 'mine' }
    const out = mergeProps(consumer, { role: 'button' })
    expectTypeOf(out).toExtend<ButtonLikeProps>()
    expect(out.id).toBe('mine')
  })
})
