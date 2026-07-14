/**
 * OpenTUI bindings translator — pure-logic tests (no terminal runtime needed).
 *
 * `normalize` maps the core's substrate-agnostic logical surface to OpenTUI
 * (terminal) props. It encodes the OpenTUI-specific divergences the SPECs call
 * out:
 *   - The terminal has no accessibility tree → the entire ARIA attr vocabulary
 *     (role/label/checked/expanded/value-range/grid/live …) is dropped.
 *   - The pointer model is the mouse: onPress → onMouseDown, pointer down/up →
 *     mouse down/up, enter/leave → over/out, move → move; cancel is dropped.
 *   - onValueChange → onChange (payload-wrapped, handles input + select arity),
 *     onWheel → onMouseScroll (payload-wrapped); onScroll/onScrollEnd are dropped
 *     (a <scrollbox> has no scroll-position callback prop).
 *   - onKeyDown passes through; onKeyUp is dropped (terminals deliver presses).
 *   - hidden → visible (inverted), focusable → focusable, disabled passes through.
 */
import { describe, expect, it, vi } from 'vitest'
import { normalize } from '@dunky.dev/opentui-state-machine'

describe('opentui normalize — handlers', () => {
  it('maps onPress to onMouseDown (no synthetic click in a terminal)', () => {
    const onPress = vi.fn()
    expect(normalize({ onPress })).toEqual({ onMouseDown: onPress })
  })

  it('maps pointer down/up to mouse down/up', () => {
    const down = vi.fn()
    const up = vi.fn()
    expect(normalize({ onPointerDown: down, onPointerUp: up })).toEqual({
      onMouseDown: down,
      onMouseUp: up,
    })
  })

  it('maps pointer enter/leave to mouse over/out and move to move', () => {
    const enter = vi.fn()
    const leave = vi.fn()
    const move = vi.fn()
    expect(
      normalize({ onPointerEnter: enter, onPointerLeave: leave, onPointerMove: move }),
    ).toEqual({ onMouseOver: enter, onMouseOut: leave, onMouseMove: move })
  })

  it('drops handlers with no OpenTUI prop to bind to', () => {
    const out = normalize({
      onPointerCancel: vi.fn(),
      onContextMenu: vi.fn(),
      onDoublePress: vi.fn(),
      onKeyUp: vi.fn(),
      onScroll: vi.fn(),
      onScrollEnd: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
    })
    expect(out).toEqual({})
  })

  it('passes onKeyDown through unwrapped', () => {
    const onKeyDown = vi.fn()
    expect(normalize({ onKeyDown }).onKeyDown).toBe(onKeyDown)
  })

  it('passes mouse handlers through unwrapped (PointerPayload tolerates the event)', () => {
    const onPress = vi.fn()
    const out = normalize({ onPress })
    ;(out.onMouseDown as (e: unknown) => void)({ x: 3, y: 4 })
    expect(onPress).toHaveBeenCalledWith({ x: 3, y: 4 })
  })
})

describe('opentui normalize — value / scroll payload wrapping', () => {
  it('maps onValueChange to onChange, wrapping <input>’s bare string value', () => {
    const onValueChange = vi.fn()
    const out = normalize({ onValueChange })
    expect('onChange' in out).toBe(true)
    ;(out.onChange as (v: unknown) => void)('hello')
    expect(onValueChange).toHaveBeenCalledWith({ value: 'hello' })
  })

  it('handles <select>’s (index, option) onChange — index as value, option alongside', () => {
    const onValueChange = vi.fn()
    const out = normalize({ onValueChange })
    const option = { name: 'Blue', value: 'blue' }
    ;(out.onChange as (i: number, o: unknown) => void)(2, option)
    expect(onValueChange).toHaveBeenCalledWith({ value: 2, option })
  })

  it('maps onWheel to onMouseScroll, building a line-unit WheelPayload from MouseEvent.scroll', () => {
    const onWheel = vi.fn()
    const out = normalize({ onWheel })
    expect('onMouseScroll' in out).toBe(true)
    ;(out.onMouseScroll as (e: unknown) => void)({ scroll: { delta: 3, direction: 'down' } })
    expect(onWheel).toHaveBeenCalledWith({ deltaY: 3, deltaUnit: 'line' })
  })

  it('negates wheel deltaY when scrolling up (DOM-convention sign)', () => {
    const onWheel = vi.fn()
    const out = normalize({ onWheel })
    ;(out.onMouseScroll as (e: unknown) => void)({ scroll: { delta: 2, direction: 'up' } })
    expect(onWheel).toHaveBeenCalledWith({ deltaY: -2, deltaUnit: 'line' })
  })

  it('routes horizontal wheel onto deltaX (left negative, right positive)', () => {
    const onWheel = vi.fn()
    const out = normalize({ onWheel })
    ;(out.onMouseScroll as (e: unknown) => void)({ scroll: { delta: 4, direction: 'left' } })
    expect(onWheel).toHaveBeenCalledWith({ deltaX: -4, deltaUnit: 'line' })
    ;(out.onMouseScroll as (e: unknown) => void)({ scroll: { delta: 4, direction: 'right' } })
    expect(onWheel).toHaveBeenCalledWith({ deltaX: 4, deltaUnit: 'line' })
  })
})

describe('opentui normalize — attributes', () => {
  it('drops the entire ARIA vocabulary (terminal has no accessibility tree)', () => {
    const out = normalize({
      id: 'x',
      role: 'button',
      label: 'Save',
      describedBy: 'd',
      labelledBy: 'l',
      controls: 'c',
      expanded: true,
      selected: true,
      modal: true,
      hasPopup: 'menu',
      checked: 'mixed',
      pressed: true,
      current: 'page',
      busy: true,
      invalid: true,
      required: true,
      readOnly: true,
      activeDescendant: 'o',
      errorMessage: 'e',
      owns: 'w',
      valueMin: 0,
      valueMax: 100,
      valueNow: 50,
      valueText: '50%',
      orientation: 'horizontal',
      sort: 'ascending',
      autoComplete: 'list',
      multiline: true,
      multiSelectable: true,
      level: 2,
      posInSet: 1,
      setSize: 10,
      colCount: 3,
      colIndex: 1,
      colSpan: 1,
      rowCount: 9,
      rowIndex: 2,
      rowSpan: 1,
      live: 'polite',
      atomic: true,
    })
    expect(out).toEqual({})
  })

  it('maps hidden to visible (inverted)', () => {
    expect(normalize({ hidden: true })).toEqual({ visible: false })
    expect(normalize({ hidden: false })).toEqual({ visible: true })
  })

  it('passes focusable through as a boolean', () => {
    expect(normalize({ focusable: true })).toEqual({ focusable: true })
    expect(normalize({ focusable: 1 as never }).focusable).toBe(true)
    expect(normalize({ focusable: 0 as never }).focusable).toBe(false)
  })

  it('passes disabled through (component dims/skips the renderable itself)', () => {
    expect(normalize({ disabled: true })).toEqual({ disabled: true })
  })

  it('passes unknown attrs through unchanged (e.g. data-state, style)', () => {
    expect(normalize({ 'data-state': 'open', style: { fg: 'red' } })).toEqual({
      'data-state': 'open',
      style: { fg: 'red' },
    })
  })

  it('skips undefined values', () => {
    expect(normalize({ role: undefined, focusable: true })).toEqual({ focusable: true })
  })
})

describe('opentui normalize — combined surface (focusable button shape)', () => {
  it('translates a realistic button binding set', () => {
    const onPress = vi.fn()
    const out = normalize({
      role: 'button', // dropped (no a11y tree)
      label: 'Submit', // dropped
      disabled: false,
      focusable: true,
      hidden: false,
      onPress,
      onContextMenu: vi.fn(), // dropped (no per-gesture slot)
    })
    expect(out).toEqual({
      disabled: false,
      focusable: true,
      visible: true,
      onMouseDown: onPress,
    })
  })
})
