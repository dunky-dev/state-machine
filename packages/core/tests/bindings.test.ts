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
import type {
  AttrBindings,
  ChangePayload,
  EventBindings,
  KeyboardPayload,
  PointerPayload,
  ScrollPayload,
  WheelPayload,
} from '../src'

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

  it('payload preventDefault is callable and optional', () => {
    let prevented = false
    const onPress: EventBindings['onPress'] = e => e?.preventDefault?.()
    onPress?.({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
    expect(() => onPress?.()).not.toThrow() // payload is optional
  })

  it('carries the value-change + interaction handlers (the expanded surface)', () => {
    const fired: string[] = []
    const ev: EventBindings = {
      onValueChange: (e?: ChangePayload) => fired.push(`change:${String(e?.value)}`),
      onContextMenu: () => fired.push('context'),
      onDoublePress: () => fired.push('double'),
      onWheel: (e?: WheelPayload) => fired.push(`wheel:${e?.deltaY ?? 0}`),
      onScroll: (e?: ScrollPayload) => fired.push(`scroll:${e?.offsetY ?? 0}`),
      onScrollEnd: () => fired.push('scrollEnd'),
    }
    ev.onValueChange?.({ value: true })
    ev.onWheel?.({ deltaY: 10, deltaUnit: 'pixel' })
    ev.onScroll?.({ offsetY: 200 })
    expect(fired).toEqual(['change:true', 'wheel:10', 'scroll:200'])
  })

  it('ChangePayload narrows its value to the widget type', () => {
    const sliderChange: EventBindings['onValueChange'] = e => {
      const n: number | undefined = (e as ChangePayload<number> | undefined)?.value
      return void n
    }
    expect(() => sliderChange?.({ value: 0.5 })).not.toThrow()
  })

  it('carries the full attribute vocabulary (state, range, structure, live)', () => {
    const attrs: AttrBindings = {
      checked: 'mixed',
      pressed: true,
      current: 'page',
      busy: true,
      invalid: 'spelling',
      required: true,
      readOnly: false,
      label: 'Volume',
      activeDescendant: 'opt-3',
      errorMessage: 'err-1',
      owns: 'listbox-1',
      valueMin: 0,
      valueMax: 100,
      valueNow: 70,
      valueText: '70%',
      orientation: 'horizontal',
      sort: 'ascending',
      autoComplete: 'list',
      multiline: true,
      multiSelectable: false,
      level: 2,
      posInSet: 3,
      setSize: 10,
      colCount: 5,
      colIndex: 2,
      colSpan: 1,
      rowCount: 20,
      rowIndex: 4,
      rowSpan: 1,
      live: 'polite',
      atomic: true,
    }
    expect(attrs.checked).toBe('mixed')
    expect(attrs.valueNow).toBe(70)
    expect(attrs.live).toBe('polite')
  })
})
