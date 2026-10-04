/**
 * Vue mergeProps — consumer props + the component's normalized props.
 * Inherits handler composition (consumer first, `defaultPrevented` veto) and
 * library-wins from the agnostic base; adds Vue's own shapes: `class`/`style`
 * of any form merge as `[consumer, library]` (Vue normalizes arrays), and an
 * array of consumer handlers — what Vue's own mergeProps hands a component
 * through `attrs` — composes like a single handler.
 */
import { h, type HTMLAttributes } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { mergeProps } from '@dunky.dev/vue-state-machine'

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

  it('composes an array of consumer handlers like one handler, veto included', () => {
    const calls: string[] = []
    const merged = mergeProps(
      { onClick: [() => calls.push('first'), () => calls.push('second')] },
      { onClick: () => calls.push('library') },
    )
    call(merged, 'onClick')
    call(merged, 'onClick', { defaultPrevented: true })
    expect(calls).toEqual(['first', 'second', 'library', 'first', 'second'])
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

  it('keeps a one-sided class or style as-is', () => {
    const style = { color: 'blue' }
    expect(mergeProps({ class: ['a'] }, { style })).toEqual({ class: ['a'], style })
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
})
