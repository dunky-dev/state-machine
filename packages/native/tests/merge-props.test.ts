import { describe, expect, it, vi } from 'vitest'
import { mergeProps } from '@dunky.dev/state-machine-native'

describe('mergeProps', () => {
  it('inherits handler composition from the agnostic base', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onPress: consumer }, { onPress: library })
    ;(merged.onPress as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).toHaveBeenCalledOnce()
  })

  it('inherits library-wins on plain attrs', () => {
    const out = mergeProps({ accessibilityRole: 'button' }, { accessibilityRole: 'menu' })
    expect(out.accessibilityRole).toBe('menu')
  })

  it('wraps overlapping styles into an array — consumer first, library second', () => {
    const consumerStyle = { color: 'red' }
    const libStyle = { color: 'blue' }
    const out = mergeProps({ style: consumerStyle }, { style: libStyle })
    expect(out.style).toEqual([consumerStyle, libStyle])
  })

  it('passes through an already-array consumer style alongside the library style', () => {
    const consumerStyle = [{ color: 'red' }, { fontSize: 14 }]
    const libStyle = { color: 'blue' }
    const out = mergeProps({ style: consumerStyle }, { style: libStyle })
    expect(out.style).toEqual([consumerStyle, libStyle])
  })

  it('library style wins when consumer omits style', () => {
    const libStyle = { color: 'blue' }
    const out = mergeProps({ accessible: true }, { style: libStyle })
    expect(out.style).toBe(libStyle)
  })

  it('does not invent a className branch', () => {
    // RN has no className; if a consumer somehow sets one + library too,
    // last-wins (the agnostic base) applies, no concatenation.
    const out = mergeProps({ className: 'a' }, { className: 'b' })
    expect(out.className).toBe('b')
  })
})
