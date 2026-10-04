// @vitest-environment jsdom
/**
 * Vue DOM bindings translator. The vocabulary-accounting suite pins that every
 * key lands on its declared target; these tests prove the targets on real
 * elements patched by Vue's own renderer — each handler fires on its DOM
 * event, the payload adapters read real events, and ARIA values serialize as
 * the spec's tokens.
 */
import { h, render } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { ChangePayload, WheelPayload } from '@dunky.dev/state-machine-bindings'
import { normalize } from '@dunky.dev/vue-state-machine'
import { ATTR_MAP, HANDLER_MAP } from '../src/normalize'
import { describeVocabularyAccounting } from '../../shared/bindings/tests/fixtures/vocabulary-accounting'

// Each logical handler's Vue listener prop and the DOM event it must catch,
// written out by hand: Vue derives the event by hyphenating the prop's camel
// tail, so `onPointerEnter` would listen to `pointer-enter` and never fire.
const LISTENERS: Record<string, [prop: string, event: string]> = {
  onPress: ['onClick', 'click'],
  onPointerEnter: ['onPointerenter', 'pointerenter'],
  onPointerLeave: ['onPointerleave', 'pointerleave'],
  onPointerMove: ['onPointermove', 'pointermove'],
  onPointerDown: ['onPointerdown', 'pointerdown'],
  onPointerUp: ['onPointerup', 'pointerup'],
  onPointerCancel: ['onPointercancel', 'pointercancel'],
  onFocus: ['onFocus', 'focus'],
  onBlur: ['onBlur', 'blur'],
  onKeyDown: ['onKeydown', 'keydown'],
  onKeyUp: ['onKeyup', 'keyup'],
  onValueChange: ['onInput', 'input'],
  onContextMenu: ['onContextmenu', 'contextmenu'],
  onDoublePress: ['onDblclick', 'dblclick'],
  onWheel: ['onWheel', 'wheel'],
  onScroll: ['onScroll', 'scroll'],
  onScrollEnd: ['onScrollend', 'scrollend'],
}

// One element through Vue's DOM renderer — the real patchProp / patchEvent path.
function renderElement<E extends Element = HTMLElement>(
  tag: string,
  props: Record<string, unknown>,
  container: Element = document.createElement('div'),
): E {
  render(h(tag, props), container)
  return container.firstElementChild as E
}

const attributesOf = (el: Element): Record<string, string> =>
  Object.fromEntries(Array.from(el.attributes, a => [a.name, a.value]))

describe('vue normalize — handlers on real elements', () => {
  it('names every handler with the Vue listener prop for its DOM event', () => {
    const expected = Object.fromEntries(
      Object.entries(LISTENERS).map(([key, [prop]]) => [key, prop]),
    )
    expect(HANDLER_MAP).toEqual(expected)
  })

  it('fires every mapped handler on its DOM event', () => {
    for (const [key, [, event]] of Object.entries(LISTENERS)) {
      const handler = vi.fn()
      renderElement('div', normalize({ [key]: handler })).dispatchEvent(new Event(event))
      expect({ key, calls: handler.mock.calls.length }).toEqual({ key, calls: 1 })
    }
  })

  it('onValueChange receives a ChangePayload read from the real input', () => {
    const onValueChange = vi.fn()
    const input = renderElement<HTMLInputElement>('input', normalize({ onValueChange }))
    input.value = 'hi'
    input.dispatchEvent(new Event('input'))
    expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ value: 'hi' }))
  })

  it("an adapted payload's preventDefault cancels the real event (bound, no illegal invocation)", () => {
    const onValueChange = (p?: ChangePayload) => p?.preventDefault?.()
    const onWheel = (p?: WheelPayload) => p?.preventDefault?.()
    const el = renderElement('input', normalize({ onValueChange, onWheel }))
    for (const event of [
      new Event('input', { cancelable: true }),
      new WheelEvent('wheel', { cancelable: true }),
    ]) {
      el.dispatchEvent(event)
      expect({ type: event.type, prevented: event.defaultPrevented }).toEqual({
        type: event.type,
        prevented: true,
      })
    }
  })
})

describe('vue normalize — attributes on real elements', () => {
  it('serializes ARIA booleans as "true"/"false" tokens and focusable as tabindex 0/-1', () => {
    const el = renderElement(
      'div',
      normalize({ role: 'switch', id: 'sw', checked: false, expanded: true, focusable: true }),
    )
    expect(attributesOf(el)).toEqual({
      role: 'switch',
      id: 'sw',
      'aria-checked': 'false',
      'aria-expanded': 'true',
      tabindex: '0',
    })
    expect(renderElement('div', normalize({ focusable: false })).getAttribute('tabindex')).toBe(
      '-1',
    )
  })

  it('removes an attribute once its binding turns undefined', () => {
    const container = document.createElement('div')
    renderElement('div', normalize({ describedBy: 'tip', hidden: true }), container)
    const el = renderElement('div', normalize({ describedBy: undefined, hidden: true }), container)
    expect(attributesOf(el)).toEqual({ 'aria-hidden': 'true' })
  })
})

describe('vue normalize — pass-through', () => {
  it('passes unknown keys through unchanged (class, data-*)', () => {
    expect(normalize({ 'data-state': 'open', class: 'x' })).toEqual({
      'data-state': 'open',
      class: 'x',
    })
  })

  it('drops undefined values, so they never override a consumer prop in mergeProps', () => {
    expect(normalize({ role: undefined, id: 'x' })).toEqual({ id: 'x' })
  })
})

describeVocabularyAccounting('vue', normalize, { map: HANDLER_MAP }, { map: ATTR_MAP })
