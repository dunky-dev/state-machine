/**
 * Svelte DOM bindings translator — pure-logic tests (no DOM runtime needed).
 *
 * The `aria-` projection is @dunky.dev/state-machine-dom's, pinned there and
 * accounted for here by the shared vocabulary suite. These tests pin what is
 * Svelte's own: event props are the DOM's lowercase attribute names
 * (`onclick`, `oninput`, `ondblclick`) and `focusable` lands on `tabindex`.
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

describe('svelte normalize — attributes', () => {
  it('maps focusable to tabindex (lowercase; true → 0, false → -1)', () => {
    expect(normalize({ focusable: true })).toEqual({ tabindex: 0 })
    expect(normalize({ focusable: false })).toEqual({ tabindex: -1 })
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

describeVocabularyAccounting('svelte', normalize, { map: HANDLER_MAP }, { map: ATTR_MAP })
