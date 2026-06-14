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
import { normalize } from '@chimba-ui/machine-native'

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
