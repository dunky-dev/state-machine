// @vitest-environment jsdom
/**
 * Svelte normalize on real elements. Svelte 5 attaches a spread `on*` prop as
 * a listener for exactly the event named after `on` (case-sensitive), so this
 * proves every mapped handler fires for its DOM event, the adapted payloads
 * act on the real event, and the attrs land as the ARIA tokens a host reads.
 */
import { render, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { HandlerKey } from '@dunky.dev/state-machine-bindings'
import { normalize } from '@dunky.dev/svelte-state-machine'
import { HANDLER_MAP } from '../src/normalize'
import Spread from './fixtures/spread.svelte'

// The DOM event a user action produces for each logical handler — listed
// independently of HANDLER_MAP, so a mis-cased prop can't pass by agreeing
// with itself.
const DOM_EVENT: Record<HandlerKey, string> = {
  onPress: 'click',
  onPointerEnter: 'pointerenter',
  onPointerLeave: 'pointerleave',
  onPointerMove: 'pointermove',
  onPointerDown: 'pointerdown',
  onPointerUp: 'pointerup',
  onPointerCancel: 'pointercancel',
  onFocus: 'focus',
  onBlur: 'blur',
  onKeyDown: 'keydown',
  onKeyUp: 'keyup',
  onValueChange: 'input',
  onContextMenu: 'contextmenu',
  onDoublePress: 'dblclick',
  onWheel: 'wheel',
  onScroll: 'scroll',
  onScrollEnd: 'scrollend',
}

// Scoped to its own container: one test may mount several.
const mount = (bindings: Record<string, unknown>, tag?: string): HTMLElement =>
  within(render(Spread, { tag, attrs: normalize(bindings) }).container).getByTestId('target')

describe('svelte normalize — on a real element', () => {
  it('fires every mapped handler for its DOM event', () => {
    for (const key of Object.keys(HANDLER_MAP) as HandlerKey[]) {
      const handler = vi.fn()
      mount({ [key]: handler }).dispatchEvent(new Event(DOM_EVENT[key], { bubbles: true }))
      expect({ key, calls: handler.mock.calls.length }).toEqual({ key, calls: 1 })
    }
  })

  it("adapted payloads carry the real event's value and a working preventDefault", () => {
    let payload: { value?: unknown; preventDefault?: () => void } | undefined
    const input = mount({ onValueChange: (p: typeof payload) => (payload = p) }, 'input')
    ;(input as HTMLInputElement).value = 'hi'
    const event = new Event('input', { bubbles: true, cancelable: true })
    input.dispatchEvent(event)

    expect(payload?.value).toBe('hi')
    payload?.preventDefault?.() // a detached native preventDefault throws Illegal invocation
    expect(event.defaultPrevented).toBe(true)
  })

  it('writes ARIA states as literal tokens and focusable as tabindex', () => {
    const el = mount({ expanded: false, hidden: true, focusable: false })
    expect(el.getAttribute('aria-expanded')).toBe('false')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.getAttribute('tabindex')).toBe('-1')
  })

  // connect() rebuilds its closures on every snapshot, so the spread must
  // always call the latest one — delegated (click) and direct (pointerenter).
  it('keeps spread handlers current when the bindings change', async () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const { getByTestId, rerender } = render(Spread, {
      attrs: normalize({ onPress: stale, onPointerEnter: stale }),
    })
    await rerender({ attrs: normalize({ onPress: fresh, onPointerEnter: fresh }) })

    const el = getByTestId('target')
    el.dispatchEvent(new Event('click', { bubbles: true }))
    el.dispatchEvent(new Event('pointerenter'))
    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(2)
  })
})
