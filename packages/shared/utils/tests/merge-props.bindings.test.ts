/**
 * R9b — mergeProps over the agnostic bindings vocabulary.
 *
 * The existing merge-props tests use a DOM-ish key (onClick). This pins that
 * the SAME mergeProps composes the engine's agnostic handler names
 * (onPress/onKeyDown/onPointerEnter — any `on*`, not just onClick) and
 * last-wins-merges plain attrs (role/id), with the defaultPrevented
 * short-circuit. Shapes are inline (not imported from machine-core) to keep
 * shared/utils dependency-free — mergeProps is structurally typed anyway.
 */
import { mergeProps } from '@dunky.dev/state-machine-utils'
import { describe, expect, it, vi } from 'vitest'

describe('mergeProps × bindings vocabulary', () => {
  it('composes overlapping onPress — consumer then library', () => {
    const order: string[] = []
    const merged = mergeProps(
      { onPress: () => order.push('consumer') },
      { onPress: () => order.push('library') },
    )
    ;(merged.onPress as () => void)()
    expect(order).toEqual(['consumer', 'library'])
  })

  it('composes onKeyDown/onPointerEnter too (any on* handler)', () => {
    const k: string[] = []
    const merged = mergeProps(
      { onKeyDown: () => k.push('c:key'), onPointerEnter: () => k.push('c:enter') },
      { onKeyDown: () => k.push('l:key'), onPointerEnter: () => k.push('l:enter') },
    )
    ;(merged.onKeyDown as (e: unknown) => void)({ defaultPrevented: false })
    ;(merged.onPointerEnter as (e: unknown) => void)({ defaultPrevented: false })
    expect(k).toEqual(['c:key', 'l:key', 'c:enter', 'l:enter'])
  })

  it('library wins on attr conflicts (role/id), consumer-only attrs pass through', () => {
    const merged = mergeProps(
      { id: 'consumer', role: 'menu', 'data-testid': 'mine' },
      { id: 'lib', expanded: true },
    )
    expect(merged.id).toBe('lib') // library wins
    expect(merged.role).toBe('menu') // consumer-only kept
    expect(merged.expanded).toBe(true)
    expect(merged['data-testid']).toBe('mine')
  })

  it('respects defaultPrevented on the agnostic payload (skips library handler)', () => {
    const library = vi.fn()
    const merged = mergeProps(
      { onKeyDown: (e: { defaultPrevented?: boolean }) => (e.defaultPrevented = true) },
      { onKeyDown: library },
    )
    ;(merged.onKeyDown as (e: unknown) => void)({ defaultPrevented: false })
    expect(library).not.toHaveBeenCalled()
  })

  it('returns a fresh object — does not mutate the consumer bindings', () => {
    const consumer = { onPress: () => {} }
    const merged = mergeProps(consumer, { onFocus: () => {} })
    expect(merged).not.toBe(consumer)
    expect('onFocus' in consumer).toBe(false)
  })
})
