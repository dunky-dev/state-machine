/**
 * Svelte mergeProps — consumer + component props, Svelte-style: the agnostic
 * rules (handlers compose consumer-first with the defaultPrevented veto,
 * library wins) over every `on*` key, Svelte's lowercase event props included,
 * plus Svelte's attribute conventions for `class` and `style`.
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

  it('composes camelCase handlers too', () => {
    const consumer = vi.fn()
    const library = vi.fn()
    const merged = mergeProps({ onClick: consumer }, { onClick: library })
    ;(merged.onClick as (e: unknown) => void)({ defaultPrevented: false })
    expect(consumer).toHaveBeenCalledOnce()
    expect(library).toHaveBeenCalledOnce()
  })

  it('library wins on plain attrs', () => {
    const out = mergeProps({ id: 'consumer' }, { id: 'lib' })
    expect(out.id).toBe('lib')
  })

  it('joins overlapping string classes into one string', () => {
    expect(mergeProps({ class: 'a b' }, { class: 'c' }).class).toBe('a b c')
  })

  it('merges overlapping class of other shapes as [consumer, library]', () => {
    const consumerClass = ['a', { b: true }]
    expect(mergeProps({ class: consumerClass }, { class: 'c' }).class).toEqual([consumerClass, 'c'])
    expect(mergeProps({ class: 'a' }, { class: { c: true } }).class).toEqual(['a', { c: true }])
  })

  // A nullish handler still wins, as in the agnostic base every target shares.
  it("keeps the consumer's class and style over nullish library ones, but not handlers", () => {
    const onclick = vi.fn()
    const out = mergeProps(
      { class: 'mine', style: 'color: red', onclick },
      { class: undefined, style: null, onclick: null },
    )
    expect(out).toMatchObject({ class: 'mine', style: 'color: red', onclick: null })
  })

  it('carries symbol keys (Svelte attachments) from both sides', () => {
    const ours = Symbol('consumer attachment')
    const theirs = Symbol('library attachment')
    const out: Record<symbol, unknown> = mergeProps({ [ours]: 1, id: 'a' }, {
      [theirs]: 2,
    } as Record<string, unknown>)
    expect([out[ours], out[theirs]]).toEqual([1, 2])
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
