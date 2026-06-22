import { describe, expect, it, vi } from 'vitest'
import { mergeProps } from '@dunky.dev/opentui-state-machine'

describe('mergeProps', () => {
  it('inherits handler composition from the agnostic base', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onMouseDown: consumer }, { onMouseDown: library })
    ;(merged.onMouseDown as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).toHaveBeenCalledOnce()
  })

  it('inherits library-wins on plain attrs', () => {
    const out = mergeProps({ focusable: false }, { focusable: true })
    expect(out.focusable).toBe(true)
  })

  it('merges overlapping style objects — library wins on conflicting keys', () => {
    const out = mergeProps({ style: { fg: 'red', padding: 2 } }, { style: { fg: 'blue' } })
    expect(out.style).toEqual({ fg: 'blue', padding: 2 })
  })

  it('library style wins when consumer omits style', () => {
    const libStyle = { fg: 'blue' }
    const out = mergeProps({ focusable: true }, { style: libStyle })
    expect(out.style).toBe(libStyle)
  })

  it('does not wrap styles into an array (OpenTUI style is a plain object)', () => {
    const out = mergeProps({ style: { fg: 'red' } }, { style: { fg: 'blue' } })
    expect(Array.isArray(out.style)).toBe(false)
  })

  it('does not invent a className branch (terminal has no className)', () => {
    const out = mergeProps({ className: 'a' }, { className: 'b' })
    expect(out.className).toBe('b')
  })
})
