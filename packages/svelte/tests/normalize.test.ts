/**
 * Svelte DOM bindings translator — pure-logic tests (no DOM runtime needed).
 *
 * `normalize` maps the core's substrate-agnostic logical surface to the props
 * a Svelte 5 element spread expects. These tests pin the FULL vocabulary so
 * every logical binding has an explicit, asserted target. The differences
 * from the React DOM normalizer are deliberate and pinned: event props are
 * the lowercase DOM attribute names (`onclick`, `oninput`, `ondblclick`) and
 * `focusable` lands on `tabindex`.
 */
import { describe, expect, it, vi } from 'vitest'
import { normalize } from '@dunky.dev/svelte-state-machine'
import { ATTR_MAP, HANDLER_MAP } from '../src/normalize'
import { describeVocabularyAccounting } from '../../shared/bindings/tests/fixtures/vocabulary-accounting'

describe('svelte normalize — handlers', () => {
  it('maps onPress to onclick (the DOM activation event)', () => {
    const onPress = vi.fn()
    expect(normalize({ onPress })).toEqual({ onclick: onPress })
  })

  it('maps the full pointer family to the lowercase DOM pointer events', () => {
    const [enter, leave, move, down, up, cancel] = Array.from({ length: 6 }, () => vi.fn())
    expect(
      normalize({
        onPointerEnter: enter,
        onPointerLeave: leave,
        onPointerMove: move,
        onPointerDown: down,
        onPointerUp: up,
        onPointerCancel: cancel,
      }),
    ).toEqual({
      onpointerenter: enter,
      onpointerleave: leave,
      onpointermove: move,
      onpointerdown: down,
      onpointerup: up,
      onpointercancel: cancel,
    })
  })

  it('maps onFocus / onBlur to onfocus / onblur', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    expect(normalize({ onFocus, onBlur })).toEqual({ onfocus: onFocus, onblur: onBlur })
  })

  it('maps both keyboard handlers to onkeydown / onkeyup', () => {
    const onKeyDown = vi.fn()
    const onKeyUp = vi.fn()
    expect(normalize({ onKeyDown, onKeyUp })).toEqual({ onkeydown: onKeyDown, onkeyup: onKeyUp })
  })
})

describe('svelte normalize — attributes', () => {
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

  // Booleans pass through: Svelte writes a non-boolean attribute's `false` as
  // the literal "false" token (pinned on the DOM in normalize.dom.test.ts).
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

  it('maps focusable to tabindex (lowercase; true → 0, false → -1)', () => {
    expect(normalize({ focusable: true })).toEqual({ tabindex: 0 })
    expect(normalize({ focusable: false })).toEqual({ tabindex: -1 })
  })

  it('maps role and id straight through (same name)', () => {
    expect(normalize({ role: 'tooltip', id: 't:1' })).toEqual({ role: 'tooltip', id: 't:1' })
  })

  it('passes unknown attrs through unchanged (e.g. data-state, class)', () => {
    expect(normalize({ 'data-state': 'open', class: 'x' })).toEqual({
      'data-state': 'open',
      class: 'x',
    })
  })

  it('skips undefined values', () => {
    expect(normalize({ role: undefined, id: 'x' })).toEqual({ id: 'x' })
  })
})

describe('svelte normalize — expanded handler surface', () => {
  it('maps each value-change / interaction handler to its Svelte DOM event prop', () => {
    const out = normalize({
      onValueChange: vi.fn(),
      onContextMenu: vi.fn(),
      onDoublePress: vi.fn(),
      onWheel: vi.fn(),
      onScroll: vi.fn(),
      onScrollEnd: vi.fn(),
    })
    expect(Object.keys(out).sort()).toEqual(
      ['oncontextmenu', 'ondblclick', 'oninput', 'onscroll', 'onscrollend', 'onwheel'].sort(),
    )
  })

  it('passes onContextMenu / onDoublePress through unwrapped (same payload shape)', () => {
    const onContextMenu = vi.fn()
    const onDoublePress = vi.fn()
    const out = normalize({ onContextMenu, onDoublePress })
    expect(out.oncontextmenu).toBe(onContextMenu)
    expect(out.ondblclick).toBe(onDoublePress)
  })

  // Payload construction is pinned once in @dunky.dev/state-machine-dom's own
  // tests; this only proves normalize WRAPS the handler with its adapter.
  it('onValueChange receives the adapted ChangePayload, not the raw event', () => {
    const onValueChange = vi.fn()
    const out = normalize({ onValueChange })
    ;(out.oninput as (e: unknown) => void)({ target: { value: 'hi', type: 'text' } })
    expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ value: 'hi' }))
  })
})

describe('svelte normalize — expanded attribute surface', () => {
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
})

describeVocabularyAccounting('svelte', normalize, { map: HANDLER_MAP }, { map: ATTR_MAP })
