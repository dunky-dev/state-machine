/**
 * Svelte mergeProps — consumer + component props, Svelte-style. Inherits
 * handler composition (with the defaultPrevented veto) and library-wins from
 * the agnostic base, extends the composition to Svelte's lowercase event
 * props, and layers Svelte's attribute conventions: `class` of any shape
 * merged as `[consumer, library]`, `style` strings joined.
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { HTMLButtonAttributes } from 'svelte/elements'
import { mergeProps } from '@dunky.dev/svelte-state-machine'

describe('svelte mergeProps', () => {
  it('composes overlapping lowercase handlers — consumer then library', () => {
    const order: string[] = []
    const merged = mergeProps(
      { onclick: () => order.push('consumer') },
      { onclick: () => order.push('library') },
    )
    ;(merged.onclick as (e: unknown) => void)({ defaultPrevented: false })
    expect(order).toEqual(['consumer', 'library'])
  })

  it('skips the library handler when the consumer prevents default (veto)', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onkeydown: consumer }, { onkeydown: library })
    ;(merged.onkeydown as (e: unknown) => void)({ defaultPrevented: true })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).not.toHaveBeenCalled()
  })

  it('inherits camelCase handler composition from the agnostic base', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).toHaveBeenCalledOnce()
  })

  it('inherits library-wins on plain attrs', () => {
    const out = mergeProps({ id: 'consumer' }, { id: 'lib' })
    expect(out.id).toBe('lib')
  })

  it('merges overlapping class of any shape as [consumer, library]', () => {
    const consumerClass = ['a', { b: true }]
    expect(mergeProps({ class: consumerClass }, { class: 'c' }).class).toEqual([consumerClass, 'c'])
    expect(mergeProps({ class: 'a' }, { class: { c: true } }).class).toEqual(['a', { c: true }])
  })

  it('keeps a one-sided class untouched', () => {
    const consumerClass = { a: true }
    expect(mergeProps({ class: consumerClass }, { id: 'x' }).class).toBe(consumerClass)
    expect(mergeProps({ id: 'x' }, { class: 'lib' }).class).toBe('lib')
  })

  it('joins overlapping style strings, library declarations last so they win', () => {
    const out = mergeProps({ style: 'color: red' }, { style: 'color: blue' })
    expect(out.style).toBe('color: red; color: blue')
  })

  it('returns the library props as-is when the consumer passes none', () => {
    const library = { id: 'lib', onclick: vi.fn() }
    expect(mergeProps(undefined, library)).toBe(library)
  })
})

describe('svelte mergeProps typing', () => {
  it("accepts Svelte's element prop types and preserves them", () => {
    const consumer: HTMLButtonAttributes = { class: ['mine', { active: true }], onclick: () => {} }
    const out = mergeProps(consumer, { role: 'button' })
    expectTypeOf(out).toExtend<HTMLButtonAttributes>()
    expect(out.role).toBe('button')
  })
})
