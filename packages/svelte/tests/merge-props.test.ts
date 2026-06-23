import { describe, expect, it, vi } from 'vitest'
import { mergeProps } from '@dunky.dev/state-machine-svelte'

describe('mergeProps', () => {
  it('chains overlapping handlers — consumer first, library second', () => {
    const calls: string[] = []
    const consumer = vi.fn(() => calls.push('consumer'))
    const library = vi.fn(() => calls.push('library'))
    const merged = mergeProps({ onclick: consumer }, { onclick: library })
    ;(merged.onclick as (e: unknown) => void)({ defaultPrevented: false })
    expect(calls).toEqual(['consumer', 'library'])
  })

  it('skips the library handler when the consumer prevents default', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onclick: consumer }, { onclick: library })
    ;(merged.onclick as (e: unknown) => void)({ defaultPrevented: true })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).not.toHaveBeenCalled()
  })

  it('only chains lowercase on* props (Svelte event shape), not camelCase', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    // camelCase isn't a Svelte DOM event prop → library wins, no chaining.
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    expect(merged.onClick).toBe(library)
  })

  it('library wins on plain attrs', () => {
    const out = mergeProps({ id: 'consumer' }, { id: 'lib' })
    expect(out.id).toBe('lib')
  })

  it('concatenates overlapping styles as a string (consumer first, library second)', () => {
    const out = mergeProps({ style: 'color: red' }, { style: 'background: blue' })
    expect(out.style).toBe('color: red; background: blue')
  })

  it('drops a trailing semicolon on the consumer style before joining', () => {
    const out = mergeProps({ style: 'color: red;' }, { style: 'background: blue' })
    expect(out.style).toBe('color: red; background: blue')
  })

  it('library style wins when consumer omits style', () => {
    const out = mergeProps({ id: 'a' }, { style: 'color: blue' })
    expect(out.style).toBe('color: blue')
  })

  it('consumer style stays when library omits style', () => {
    const out = mergeProps({ style: 'color: red' }, { id: 'a' })
    expect(out.style).toBe('color: red')
  })

  it('concatenates overlapping class with a single space', () => {
    const out = mergeProps({ class: 'a b' }, { class: 'c' })
    expect(out.class).toBe('a b c')
  })

  it('trims edge whitespace on class; inner spacing is preserved verbatim', () => {
    const out = mergeProps({ class: '  a  ' }, { class: '  b  ' })
    // `${'  a  '} ${'  b  '}` → '  a     b  ' → trim → 'a     b'
    expect(out.class).toBe('a     b')
  })

  it('non-string class falls back to library-wins (no concat)', () => {
    const out = mergeProps({ id: 'a' }, { class: 'x' })
    expect(out.class).toBe('x')
  })

  it('returns the library props as-is when the consumer passes none', () => {
    const library = { id: 'lib', onclick: vi.fn() }
    expect(mergeProps(undefined, library)).toBe(library)
  })
})
