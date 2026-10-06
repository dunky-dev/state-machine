/**
 * Svelte DOM bindings translator — pure-logic tests (no DOM runtime needed).
 *
 * The `aria-` projection is @dunky.dev/state-machine-dom's, pinned there and
 * accounted for here by the shared vocabulary suite. These tests pin what is
 * Svelte's own and invisible to the DOM: `focusable` lands on `tabindex`,
 * handlers stay unwrapped when they can, and unknown keys pass through.
 */
import { describe, expect, it, vi } from 'vitest'
import { normalize } from '@dunky.dev/svelte-state-machine'
import { ATTR_MAP, HANDLER_MAP } from '../src/normalize'
import { describeVocabularyAccounting } from '../../shared/bindings/tests/fixtures/vocabulary-accounting'

// Which prop each handler lands on is proven where it matters, on a real
// element (normalize.dom.test.ts); this pins only what the DOM can't see.
describe('svelte normalize — handlers', () => {
  it('passes a handler whose payload already matches through unwrapped', () => {
    const onContextMenu = vi.fn()
    const onDoublePress = vi.fn()
    const out = normalize({ onContextMenu, onDoublePress })
    expect(out.oncontextmenu).toBe(onContextMenu)
    expect(out.ondblclick).toBe(onDoublePress)
  })
})

describe('svelte normalize — attributes', () => {
  it('maps focusable to tabindex (lowercase; true → 0, false → -1)', () => {
    expect(normalize({ focusable: true })).toEqual({ tabindex: 0 })
    expect(normalize({ focusable: false })).toEqual({ tabindex: -1 })
  })

  // Only the vocabulary is translated: a handler outside it keeps its name, so
  // it must already be Svelte's own lowercase event prop to fire.
  it('passes unknown keys through unchanged (data-state, class, a non-vocabulary onMouseDown)', () => {
    const onMouseDown = vi.fn()
    expect(normalize({ 'data-state': 'open', class: 'x', onMouseDown })).toEqual({
      'data-state': 'open',
      class: 'x',
      onMouseDown,
    })
  })

  it('passes symbol keys (Svelte attachments) through', () => {
    const attachment = Symbol('attachment')
    expect(normalize({ [attachment]: 1 } as Record<string, unknown>)).toEqual({ [attachment]: 1 })
  })

  it('skips undefined values', () => {
    expect(normalize({ role: undefined, id: 'x' })).toEqual({ id: 'x' })
  })
})

describeVocabularyAccounting('svelte', normalize, { map: HANDLER_MAP }, { map: ATTR_MAP })
