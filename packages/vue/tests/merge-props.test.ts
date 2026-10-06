// @vitest-environment jsdom
/**
 * Vue mergeProps — consumer props + the component's normalized props.
 * Inherits handler composition (consumer first, `defaultPrevented` veto) and
 * library-wins from the agnostic base; adds Vue's own shapes: `class`/`style`
 * of any form merge as `[consumer, library]` (Vue normalizes arrays), an array
 * of consumer handlers — what Vue's own mergeProps hands a component through
 * `attrs` — keeps Vue's invoker semantics, and a consumer listening with an
 * option modifier (`onClickCapture`) still vetoes the library's `onClick`.
 */
import { h, type HTMLAttributes, type StyleValue } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { mergeProps } from '@dunky.dev/vue-state-machine'
import { renderElement } from './fixtures/render-element'

type Handler = (event?: { defaultPrevented?: boolean }) => void
const call = (props: Record<string, unknown>, key: string, event = {}) =>
  (props[key] as Handler)(event)

describe('vue mergeProps — handlers', () => {
  it('chains consumer then library on every Vue listener key shape', () => {
    for (const key of ['onClick', 'onPointerenter', 'onUpdate:open']) {
      const calls: string[] = []
      const merged = mergeProps(
        { [key]: () => calls.push('consumer') },
        { [key]: () => calls.push('library') },
      )
      call(merged, key)
      expect({ key, calls }).toEqual({ key, calls: ['consumer', 'library'] })
    }
  })

  it('skips the library handler when the consumer prevents default (veto)', () => {
    const library = vi.fn()
    const merged = mergeProps({ onClick: vi.fn() }, { onClick: library })
    call(merged, 'onClick', { defaultPrevented: true })
    expect(library).not.toHaveBeenCalled()
  })

  it("keeps a consumer handler array, so Vue's invoker semantics hold", () => {
    const calls: string[] = []
    const merged = mergeProps(
      {
        onClick: [
          () => calls.push('first'),
          undefined, // Vue skips a falsy entry
          (e: Event) => {
            calls.push('second')
            e.stopImmediatePropagation() // ...and stops at this one: the library never runs
          },
        ],
      },
      { onClick: () => calls.push('library') },
    )
    renderElement('button', merged).dispatchEvent(new Event('click'))
    expect(calls).toEqual(['first', 'second'])
  })

  it('vetoes the library entry it appends to a consumer handler array', () => {
    const library = vi.fn()
    const merged = mergeProps({ onClick: [(e: Event) => e.preventDefault()] }, { onClick: library })
    renderElement('button', merged).dispatchEvent(new Event('click', { cancelable: true }))
    expect(library).not.toHaveBeenCalled()
  })

  it('vetoes the library handler for a consumer listening with an option modifier', async () => {
    const library = vi.fn()
    const merged = mergeProps(
      { onClickCapture: (e: Event) => e.preventDefault() },
      { onClick: library },
    )
    const button = renderElement('button', merged)
    // Vue's invoker ignores a listener attached in the same millisecond the event is stamped
    // with; a real click always comes later.
    await new Promise(resolve => setTimeout(resolve, 2))
    button.dispatchEvent(new Event('click', { cancelable: true }))
    expect(library).not.toHaveBeenCalled()
  })

  it('composes a handler array only where the base composes handlers', () => {
    const library = () => {}
    expect(mergeProps({ online: [() => {}] }, { online: library }).online).toBe(library)
  })
})

describe('vue mergeProps — class / style', () => {
  it('merges overlapping class and style of any shape; Vue renders library style last', async () => {
    const merged = mergeProps(
      { class: ['a', { b: true }], style: 'color: red; margin: 0' },
      { class: 'c', style: { color: 'blue' } },
    )
    expect(await renderToString(h('div', merged))).toBe(
      '<div class="a b c" style="color:blue;margin:0;"></div>',
    )
  })

  it('keeps a one-sided class or style as-is — including against a nullish library value', () => {
    const style = { color: 'blue' }
    expect(mergeProps({ class: ['a'] }, { style })).toEqual({ class: ['a'], style })
    expect(mergeProps({ class: 'mine', style }, { class: undefined, style: null })).toEqual({
      class: 'mine',
      style,
    })
  })
})

describe('vue mergeProps — attrs', () => {
  it('library wins on plain attrs', () => {
    expect(mergeProps({ id: 'consumer', title: 't' }, { id: 'lib' })).toEqual({
      id: 'lib',
      title: 't',
    })
  })

  it('returns the library props when the consumer passes none', () => {
    const library = { id: 'lib', class: 'x' }
    expect(mergeProps(undefined, library)).toBe(library)
  })
})

describe('vue mergeProps — typing', () => {
  it("hands Vue's own attribute types back cast-free", () => {
    const consumer: HTMLAttributes = { class: 'a', onClick: () => {} }
    expectTypeOf(mergeProps(consumer, { class: 'b' })).toExtend<HTMLAttributes>()
  })

  it('types class and style as the arrays they may become, not as the consumer declared them', () => {
    const merged = mergeProps({ class: 'a', style: 'color: red' }, {})
    expectTypeOf<string[]>().toExtend<typeof merged.class>()
    expectTypeOf<StyleValue[]>().toExtend<typeof merged.style>()
  })
})
