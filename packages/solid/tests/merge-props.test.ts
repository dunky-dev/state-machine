/**
 * Solid mergeProps — consumer + component props, Solid-style. Inherits handler
 * composition (with the defaultPrevented veto) and library-wins from the agnostic
 * base; layers Solid's DOM conventions on top: `class` concat (not `className`)
 * and `style` merged into ONE object (Solid's style is an object, not React's
 * array form).
 */
import { describe, expect, it, vi } from 'vitest'
import { mergeProps } from '../src'

describe('solid mergeProps', () => {
  it('inherits handler composition from the agnostic base', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).toHaveBeenCalledOnce()
  })

  it('skips the library handler when the consumer prevents default (veto)', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: true })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).not.toHaveBeenCalled()
  })

  it('inherits library-wins on plain attrs', () => {
    const out = mergeProps({ id: 'consumer' }, { id: 'lib' })
    expect(out.id).toBe('lib')
  })

  it('merges overlapping styles into ONE object — library wins on conflicts', () => {
    const out = mergeProps(
      { style: { color: 'red', margin: 0 } },
      { style: { color: 'blue', padding: 4 } },
    )
    expect(out.style).toEqual({ color: 'blue', margin: 0, padding: 4 })
  })

  it('library style wins when consumer omits style', () => {
    const libStyle = { color: 'blue' }
    const out = mergeProps({ id: 'a' }, { style: libStyle })
    expect(out.style).toBe(libStyle)
  })

  it('consumer style stays when library omits style', () => {
    const consumerStyle = { color: 'red' }
    const out = mergeProps({ style: consumerStyle }, { id: 'a' })
    expect(out.style).toBe(consumerStyle)
  })

  it('concatenates overlapping class with a single space', () => {
    const out = mergeProps({ class: 'a b' }, { class: 'c' })
    expect(out.class).toBe('a b c')
  })

  it('trims edge whitespace; inner spacing is preserved verbatim', () => {
    const out = mergeProps({ class: '  a  ' }, { class: '  b  ' })
    expect(out.class).toBe('a     b')
  })

  it('non-string class falls back to library-wins (no concat)', () => {
    const out = mergeProps({ id: 'a' }, { class: 'x' })
    expect(out.class).toBe('x')
  })
})
