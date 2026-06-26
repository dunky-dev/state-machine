import { describe, expect, it, vi } from 'vitest'
import { mergeProps } from '@dunky.dev/state-machine-vue'

describe('mergeProps', () => {
  it('inherits handler composition from the agnostic base', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).toHaveBeenCalledOnce()
  })

  it('inherits library-wins on plain attrs', () => {
    const out = mergeProps({ id: 'consumer' }, { id: 'lib' })
    expect(out.id).toBe('lib')
  })

  it('wraps overlapping styles into an array — consumer first, library second', () => {
    const consumerStyle = { color: 'red' }
    const libStyle = { color: 'blue' }
    const out = mergeProps({ style: consumerStyle }, { style: libStyle })
    expect(out.style).toEqual([consumerStyle, libStyle])
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

  it('concatenates overlapping classes with a single space', () => {
    const out = mergeProps({ class: 'a b' }, { class: 'c' })
    expect(out.class).toBe('a b c')
  })

  it('trims edge whitespace; inner spacing is preserved verbatim', () => {
    const out = mergeProps({ class: '  a  ' }, { class: '  b  ' })
    // `${'  a  '} ${'  b  '}` → '  a     b  ' → trim → 'a     b'
    // (2 trailing + 1 separator + 2 leading = 5 inner spaces)
    expect(out.class).toBe('a     b')
  })

  it('non-string class falls back to library-wins (no concat)', () => {
    // consumer.class is unset; library's wins as a plain key.
    const out = mergeProps({ id: 'a' }, { class: 'x' })
    expect(out.class).toBe('x')
  })
})
