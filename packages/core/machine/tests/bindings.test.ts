/**
 * Bindings vocabulary (re-exported from the engine surface).
 *
 * Pins the agnostic event + attr vocabulary a component's connect() emits,
 * BEFORE any target translation. These are types; the test asserts the shape
 * compiles (the real proof) plus a runtime touch. The vocabulary itself gets
 * an in-depth review during the target sync — this only locks that it's
 * reachable and structurally what connect() will speak.
 */
import { describe, expect, it } from 'vitest'
import type { AttrBindings, EventBindings, KeyboardPayload, PointerPayload } from '../src'

describe('bindings vocabulary', () => {
  it('EventBindings carries the agnostic handler names with payloads', () => {
    const fired: string[] = []
    const ev: EventBindings = {
      onPress: (e?: PointerPayload) => fired.push(`press:${e?.button ?? 0}`),
      onPointerEnter: () => fired.push('enter'),
      onPointerLeave: () => fired.push('leave'),
      onFocus: () => fired.push('focus'),
      onBlur: () => fired.push('blur'),
      onKeyDown: (e?: KeyboardPayload) => fired.push(`key:${e?.key ?? ''}`),
    }
    ev.onPress?.({ button: 0, pointerType: 'mouse' })
    ev.onKeyDown?.({ key: 'Enter' })
    expect(fired).toEqual(['press:0', 'key:Enter'])
  })

  it('AttrBindings carries the agnostic attribute vocabulary', () => {
    const attrs: AttrBindings = {
      id: 'trigger-1',
      role: 'button',
      describedBy: 'tooltip-1',
      labelledBy: 'label-1',
      expanded: true,
      selected: false,
      disabled: false,
      hidden: false,
      focusable: true,
    }
    expect(attrs.role).toBe('button')
    expect(attrs.expanded).toBe(true)
  })

  it('AttrBindings open index allows data-*/aria-* passthrough', () => {
    const attrs: AttrBindings = {
      id: 'x',
      'data-state': 'open', // verbatim passthrough on web, dropped on RN
      'data-part': 'content',
      'aria-live': 'polite',
    }
    expect(attrs['data-state']).toBe('open')
  })

  it('payload preventDefault is callable and optional', () => {
    let prevented = false
    const onPress: EventBindings['onPress'] = e => e?.preventDefault?.()
    onPress?.({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
    expect(() => onPress?.()).not.toThrow() // payload is optional
  })
})
