/**
 * React DOM bindings translator — pure-logic tests (no DOM runtime needed).
 *
 * `normalize` maps the core's substrate-agnostic logical surface
 * (`@dunky.dev/state-machine`'s `EventBindings` + `AttrBindings`) to real
 * DOM/ARIA props. These tests pin the FULL vocabulary so every logical binding
 * has an explicit, asserted DOM target — nothing relies on accidental
 * pass-through.
 */
import { describe, expect, it, vi } from 'vitest'
import { normalize } from '@dunky.dev/react-state-machine'

describe('react normalize — handlers', () => {
  it('maps onPress to onClick (the DOM activation event)', () => {
    const onPress = vi.fn()
    expect(normalize({ onPress })).toEqual({ onClick: onPress })
  })

  it('maps the full pointer family to DOM pointer events', () => {
    const handlers = {
      onPointerEnter: vi.fn(),
      onPointerLeave: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
    }
    expect(normalize(handlers)).toEqual(handlers)
  })

  it('passes onFocus / onBlur through', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    expect(normalize({ onFocus, onBlur })).toEqual({ onFocus, onBlur })
  })

  it('maps both keyboard handlers (onKeyDown / onKeyUp)', () => {
    const onKeyDown = vi.fn()
    const onKeyUp = vi.fn()
    expect(normalize({ onKeyDown, onKeyUp })).toEqual({ onKeyDown, onKeyUp })
  })
})

describe('react normalize — attributes', () => {
  it('maps the ARIA reference attrs (describedBy / labelledBy / controls)', () => {
    expect(normalize({ describedBy: 'd', labelledBy: 'l', controls: 'c' })).toEqual({
      'aria-describedby': 'd',
      'aria-labelledby': 'l',
      'aria-controls': 'c',
    })
  })

  it('maps hasPopup to aria-haspopup (string or boolean)', () => {
    expect(normalize({ hasPopup: 'menu' })).toEqual({ 'aria-haspopup': 'menu' })
    expect(normalize({ hasPopup: true })).toEqual({ 'aria-haspopup': true })
  })

  it('maps the boolean state attrs to their aria-* equivalents', () => {
    expect(
      normalize({ expanded: true, selected: false, disabled: true, hidden: false, modal: true }),
    ).toEqual({
      'aria-expanded': true,
      'aria-selected': false,
      'aria-disabled': true,
      'aria-hidden': false,
      'aria-modal': true,
    })
  })

  it('maps focusable to tabIndex (true → 0, false → -1)', () => {
    expect(normalize({ focusable: true })).toEqual({ tabIndex: 0 })
    expect(normalize({ focusable: false })).toEqual({ tabIndex: -1 })
  })

  it('maps role and id straight through (same name)', () => {
    expect(normalize({ role: 'tooltip', id: 't:1' })).toEqual({ role: 'tooltip', id: 't:1' })
  })

  it('passes unknown attrs through unchanged (e.g. data-state)', () => {
    expect(normalize({ 'data-state': 'open' })).toEqual({ 'data-state': 'open' })
  })

  it('skips undefined values', () => {
    expect(normalize({ role: undefined, id: 'x' })).toEqual({ id: 'x' })
  })
})

describe('react normalize — combined surface (trigger shape)', () => {
  it('translates a realistic trigger binding set', () => {
    const onPress = vi.fn()
    const out = normalize({
      id: 'menu:1:trigger',
      role: 'button',
      controls: 'menu:1:content',
      hasPopup: 'menu',
      expanded: true,
      focusable: true,
      onPress,
      onKeyDown: vi.fn(),
      'data-state': 'open',
    })
    expect(out).toMatchObject({
      id: 'menu:1:trigger',
      role: 'button',
      'aria-controls': 'menu:1:content',
      'aria-haspopup': 'menu',
      'aria-expanded': true,
      tabIndex: 0,
      onClick: onPress,
      'data-state': 'open',
    })
    expect(typeof out.onKeyDown).toBe('function')
  })
})

describe('react normalize — expanded handler surface', () => {
  it('maps each value-change / interaction handler to its DOM event prop', () => {
    const out = normalize({
      onValueChange: vi.fn(),
      onContextMenu: vi.fn(),
      onDoublePress: vi.fn(),
      onWheel: vi.fn(),
      onScroll: vi.fn(),
      onScrollEnd: vi.fn(),
    })
    expect(Object.keys(out).sort()).toEqual(
      ['onChange', 'onContextMenu', 'onDoubleClick', 'onScroll', 'onScrollEnd', 'onWheel'].sort(),
    )
  })

  it('passes onContextMenu / onDoublePress through unwrapped (same payload shape)', () => {
    const onContextMenu = vi.fn()
    const onDoublePress = vi.fn()
    const out = normalize({ onContextMenu, onDoublePress })
    expect(out.onContextMenu).toBe(onContextMenu)
    expect(out.onDoubleClick).toBe(onDoublePress)
  })

  it('onValueChange receives a ChangePayload built from the DOM event', () => {
    const onValueChange = vi.fn()
    const out = normalize({ onValueChange })
    ;(out.onChange as (e: unknown) => void)({ target: { value: 'hi', type: 'text' } })
    expect(onValueChange).toHaveBeenCalledWith({
      value: 'hi',
      defaultPrevented: undefined,
      preventDefault: undefined,
    })
    ;(out.onChange as (e: unknown) => void)({ target: { checked: true, type: 'checkbox' } })
    expect(onValueChange).toHaveBeenLastCalledWith(expect.objectContaining({ value: true }))
  })

  it('onWheel receives a WheelPayload with a neutral deltaUnit (deltaMode → enum)', () => {
    const onWheel = vi.fn()
    const out = normalize({ onWheel })
    ;(out.onWheel as (e: unknown) => void)({ deltaX: 1, deltaY: 2, deltaZ: 0, deltaMode: 1 })
    expect(onWheel).toHaveBeenCalledWith(
      expect.objectContaining({ deltaX: 1, deltaY: 2, deltaZ: 0, deltaUnit: 'line' }),
    )
  })

  it('onScroll / onScrollEnd receive a neutral ScrollPayload from currentTarget geometry', () => {
    const onScroll = vi.fn()
    const out = normalize({ onScroll })
    ;(out.onScroll as (e: unknown) => void)({
      currentTarget: {
        scrollLeft: 5,
        scrollTop: 50,
        scrollWidth: 800,
        scrollHeight: 1200,
        clientWidth: 400,
        clientHeight: 600,
      },
    })
    expect(onScroll).toHaveBeenCalledWith({
      offsetX: 5,
      offsetY: 50,
      contentWidth: 800,
      contentHeight: 1200,
      viewportWidth: 400,
      viewportHeight: 600,
    })
  })
})

describe('react normalize — expanded attribute surface', () => {
  it('maps widget-state attrs to aria-*, preserving tristate/enum values', () => {
    expect(
      normalize({
        checked: 'mixed',
        pressed: true,
        current: 'page',
        busy: true,
        invalid: 'spelling',
        required: true,
        readOnly: false,
      }),
    ).toEqual({
      'aria-checked': 'mixed',
      'aria-pressed': true,
      'aria-current': 'page',
      'aria-busy': true,
      'aria-invalid': 'spelling',
      'aria-required': true,
      'aria-readonly': false,
    })
  })

  it('maps labeling + relationship attrs', () => {
    expect(
      normalize({ label: 'Volume', activeDescendant: 'opt-3', errorMessage: 'e1', owns: 'lb1' }),
    ).toEqual({
      'aria-label': 'Volume',
      'aria-activedescendant': 'opt-3',
      'aria-errormessage': 'e1',
      'aria-owns': 'lb1',
    })
  })

  it('maps value/range attrs (slider shape)', () => {
    expect(normalize({ valueMin: 0, valueMax: 100, valueNow: 70, valueText: '70%' })).toEqual({
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 70,
      'aria-valuetext': '70%',
    })
  })

  it('maps structure + grid attrs', () => {
    expect(
      normalize({
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
      }),
    ).toEqual({
      'aria-orientation': 'horizontal',
      'aria-sort': 'ascending',
      'aria-autocomplete': 'list',
      'aria-multiline': true,
      'aria-multiselectable': false,
      'aria-level': 2,
      'aria-posinset': 3,
      'aria-setsize': 10,
      'aria-colcount': 5,
      'aria-colindex': 2,
      'aria-colspan': 1,
      'aria-rowcount': 20,
      'aria-rowindex': 4,
      'aria-rowspan': 1,
    })
  })

  it('maps live-region attrs (off passes through as aria-live="off")', () => {
    expect(normalize({ live: 'off', atomic: true })).toEqual({
      'aria-live': 'off',
      'aria-atomic': true,
    })
  })

  it('translates a realistic slider binding set', () => {
    const onValueChange = vi.fn()
    const out = normalize({
      role: 'slider',
      orientation: 'horizontal',
      valueMin: 0,
      valueMax: 100,
      valueNow: 40,
      valueText: '40%',
      focusable: true,
      onValueChange,
    })
    expect(out).toMatchObject({
      role: 'slider',
      'aria-orientation': 'horizontal',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 40,
      'aria-valuetext': '40%',
      tabIndex: 0,
    })
    ;(out.onChange as (e: unknown) => void)({ target: { value: '50', type: 'range' } })
    expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ value: '50' }))
  })
})
