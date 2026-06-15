/**
 * Native bindings translator — pure-logic tests (no RN runtime needed).
 *
 * `normalize` maps the core's substrate-agnostic logical surface to React
 * Native props. It encodes the RN-specific divergences the SPECs call out:
 *   - No hover model → pointer-move/enter/leave handlers are dropped.
 *   - Keyboard handlers (onKeyDown/onKeyUp) are dropped (RN has no DOM keys).
 *   - a11y state (disabled/expanded/selected/hidden) folds into
 *     accessibilityState.
 *   - role → accessibilityRole, describedBy/labelledBy →
 *     accessibilityLabelledBy, id → nativeID.
 */
import { describe, expect, it, vi } from 'vitest'
import { normalize } from '@chimba-ui/native-state-machine'

describe('native normalize — handlers', () => {
  it('keeps onPress as-is (RN Pressable.onPress)', () => {
    const onPress = vi.fn()
    expect(normalize({ onPress })).toEqual({ onPress })
  })

  it('maps pointer down/up to RN press-in/press-out', () => {
    const down = vi.fn()
    const up = vi.fn()
    expect(normalize({ onPointerDown: down, onPointerUp: up })).toEqual({
      onPressIn: down,
      onPressOut: up,
    })
  })

  it('drops hover handlers (RN has no hover)', () => {
    const out = normalize({
      onPointerMove: vi.fn(),
      onPointerEnter: vi.fn(),
      onPointerLeave: vi.fn(),
      onPointerCancel: vi.fn(),
    })
    expect(out).toEqual({})
  })

  it('drops keyboard handlers (RN has no DOM key events)', () => {
    const out = normalize({ onKeyDown: vi.fn(), onKeyUp: vi.fn() })
    expect(out).toEqual({})
  })

  it('passes onFocus / onBlur through', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    expect(normalize({ onFocus, onBlur })).toEqual({ onFocus, onBlur })
  })
})

describe('native normalize — attributes', () => {
  it('maps role to accessibilityRole', () => {
    expect(normalize({ role: 'menu' })).toEqual({ accessibilityRole: 'menu' })
  })

  it('maps describedBy and labelledBy to accessibilityLabelledBy', () => {
    expect(normalize({ describedBy: 'x' })).toEqual({
      accessibilityLabelledBy: 'x',
    })
    expect(normalize({ labelledBy: 'y' })).toEqual({
      accessibilityLabelledBy: 'y',
    })
  })

  it('maps id to nativeID', () => {
    expect(normalize({ id: 'tooltip:1:content' })).toEqual({
      nativeID: 'tooltip:1:content',
    })
  })

  it('folds disabled/expanded/selected/hidden into accessibilityState', () => {
    const out = normalize({
      disabled: true,
      expanded: false,
      selected: true,
      hidden: false,
    })
    expect(out).toEqual({
      accessibilityState: {
        disabled: true,
        expanded: false,
        selected: true,
        hidden: false,
      },
    })
  })

  it('omits accessibilityState entirely when no a11y-state keys are present', () => {
    const out = normalize({ role: 'menu' })
    expect('accessibilityState' in out).toBe(false)
  })

  it('coerces focusable to a boolean', () => {
    expect(normalize({ focusable: 1 as never }).focusable).toBe(true)
    expect(normalize({ focusable: 0 as never }).focusable).toBe(false)
  })

  it('passes unknown attrs through unchanged (e.g. data-state)', () => {
    expect(normalize({ 'data-state': 'open' })).toEqual({
      'data-state': 'open',
    })
  })

  it('skips undefined values', () => {
    expect(normalize({ role: undefined, id: 'x' })).toEqual({ nativeID: 'x' })
  })
})

describe('native normalize — combined surface (tooltip content shape)', () => {
  it('translates a realistic tooltip content binding set', () => {
    const out = normalize({
      id: 'tooltip:1:content',
      role: 'tooltip',
      'data-state': 'delayed-open',
      'data-side': 'bottom',
      onPointerEnter: vi.fn(), // dropped (hover)
      onPointerLeave: vi.fn(), // dropped (hover)
    })
    expect(out).toEqual({
      nativeID: 'tooltip:1:content',
      accessibilityRole: 'tooltip',
      'data-state': 'delayed-open',
      'data-side': 'bottom',
    })
  })
})

describe('native normalize — DOM-ARIA-only attrs are dropped', () => {
  it('drops controls / hasPopup / modal (no RN element-attr analog)', () => {
    const out = normalize({ controls: 'menu:1:content', hasPopup: 'menu', modal: true })
    expect(out).toEqual({})
  })

  it('does not leak modal as an invalid RN prop', () => {
    expect('modal' in normalize({ modal: true })).toBe(false)
  })

  it('drops the ARIA attrs RN has no slot for', () => {
    const out = normalize({
      pressed: true,
      current: 'page',
      invalid: true,
      required: true,
      readOnly: true,
      activeDescendant: 'opt-3',
      errorMessage: 'e1',
      owns: 'lb1',
      orientation: 'horizontal',
      sort: 'ascending',
      autoComplete: 'list',
      multiline: true,
      multiSelectable: true,
      level: 2,
      posInSet: 3,
      setSize: 10,
      colCount: 5,
      colIndex: 2,
      colSpan: 1,
      rowCount: 20,
      rowIndex: 4,
      rowSpan: 1,
      atomic: true,
    })
    expect(out).toEqual({})
  })
})

describe('native normalize — focusable pairs with accessible', () => {
  it('pairs a focusable element with accessible:true (reachable by SR)', () => {
    expect(normalize({ focusable: true })).toEqual({ focusable: true, accessible: true })
  })

  it('does not force accessible when not focusable', () => {
    const out = normalize({ focusable: false })
    expect(out.focusable).toBe(false)
    expect('accessible' in out).toBe(false)
  })
})

describe('native normalize — expanded handler surface', () => {
  it('maps onValueChange / onContextMenu / scroll to their RN slots', () => {
    const out = normalize({
      onValueChange: vi.fn(),
      onContextMenu: vi.fn(),
      onScroll: vi.fn(),
      onScrollEnd: vi.fn(),
    })
    expect(Object.keys(out).sort()).toEqual(
      ['onValueChange', 'onLongPress', 'onScroll', 'onMomentumScrollEnd'].sort(),
    )
  })

  it('passes onContextMenu through to onLongPress unwrapped', () => {
    const onContextMenu = vi.fn()
    expect(normalize({ onContextMenu }).onLongPress).toBe(onContextMenu)
  })

  it('onValueChange receives a ChangePayload built from RN’s bare value', () => {
    const onValueChange = vi.fn()
    const out = normalize({ onValueChange })
    ;(out.onValueChange as (v: unknown) => void)(true)
    expect(onValueChange).toHaveBeenCalledWith({ value: true })
  })

  it('onScroll / onScrollEnd receive a neutral ScrollPayload from nativeEvent', () => {
    const onScroll = vi.fn()
    const out = normalize({ onScroll })
    ;(out.onScroll as (e: unknown) => void)({
      nativeEvent: {
        contentOffset: { x: 5, y: 50 },
        contentSize: { width: 800, height: 1200 },
        layoutMeasurement: { width: 400, height: 600 },
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

  it('drops onDoublePress and onWheel (no RN analog)', () => {
    expect(normalize({ onDoublePress: vi.fn(), onWheel: vi.fn() })).toEqual({})
  })
})

describe('native normalize — accessibilityState additions', () => {
  it('folds checked and busy into accessibilityState (with existing keys)', () => {
    expect(normalize({ checked: 'mixed', busy: true, disabled: false })).toEqual({
      accessibilityState: { checked: 'mixed', busy: true, disabled: false },
    })
  })
})

describe('native normalize — accessibilityValue fold', () => {
  it('folds valueMin/Max/Now/Text into a nested accessibilityValue object', () => {
    expect(normalize({ valueMin: 0, valueMax: 100, valueNow: 70, valueText: '70%' })).toEqual({
      accessibilityValue: { min: 0, max: 100, now: 70, text: '70%' },
    })
  })

  it('omits accessibilityValue entirely when no value-* keys are present', () => {
    expect('accessibilityValue' in normalize({ role: 'slider' })).toBe(false)
  })
})

describe('native normalize — label + live region', () => {
  it('maps label to accessibilityLabel', () => {
    expect(normalize({ label: 'Volume' })).toEqual({ accessibilityLabel: 'Volume' })
  })

  it('maps live to accessibilityLiveRegion, translating off → none', () => {
    expect(normalize({ live: 'off' })).toEqual({ accessibilityLiveRegion: 'none' })
    expect(normalize({ live: 'polite' })).toEqual({ accessibilityLiveRegion: 'polite' })
    expect(normalize({ live: 'assertive' })).toEqual({ accessibilityLiveRegion: 'assertive' })
  })

  it('drops atomic (no RN slot) but keeps live', () => {
    expect(normalize({ live: 'polite', atomic: true })).toEqual({
      accessibilityLiveRegion: 'polite',
    })
  })
})

describe('native normalize — realistic slider shape', () => {
  it('translates a slider binding set across state/value/label/handler', () => {
    const onValueChange = vi.fn()
    const out = normalize({
      role: 'slider',
      label: 'Volume',
      orientation: 'horizontal', // dropped (no RN slot)
      valueMin: 0,
      valueMax: 100,
      valueNow: 40,
      valueText: '40%',
      disabled: false,
      focusable: true,
      onValueChange,
    })
    expect(out).toMatchObject({
      accessibilityRole: 'slider',
      accessibilityLabel: 'Volume',
      accessibilityValue: { min: 0, max: 100, now: 40, text: '40%' },
      accessibilityState: { disabled: false },
      focusable: true,
      accessible: true,
    })
    expect('orientation' in out).toBe(false) // dropped, no RN slot
    ;(out.onValueChange as (v: unknown) => void)(60)
    expect(onValueChange).toHaveBeenCalledWith({ value: 60 })
  })
})
