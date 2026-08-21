/**
 * `composeHandlers` — the public handler-pair composition, the same function
 * `mergeProps` applies to overlapping `on*` props. Consumer first, library
 * after, with the consumer's `defaultPrevented` as the veto.
 */
import { describe, expect, it, vi } from 'vitest'
import { composeHandlers } from '@dunky.dev/state-machine-utils'

describe('composeHandlers', () => {
  it('runs the consumer first, then the library handler', () => {
    const order: string[] = []
    const composed = composeHandlers(
      () => order.push('consumer'),
      () => order.push('library'),
    )
    composed({ defaultPrevented: false })
    expect(order).toEqual(['consumer', 'library'])
  })

  it('skips the library handler when the consumer prevented default (veto)', () => {
    const library = vi.fn()
    const composed = composeHandlers(
      (e: unknown) => ((e as { defaultPrevented: boolean }).defaultPrevented = true),
      library,
    )
    composed({ defaultPrevented: false })
    expect(library).not.toHaveBeenCalled()
  })

  it('returns the library handler result (undefined when vetoed)', () => {
    const composed = composeHandlers(
      () => 'consumer',
      () => 'library',
    )
    expect(composed({ defaultPrevented: false })).toBe('library')
    expect(composed({ defaultPrevented: true })).toBeUndefined()
  })

  it('runs both when the first argument is not an event shape', () => {
    const library = vi.fn()
    const composed = composeHandlers(vi.fn(), library)
    composed('plain-string')
    composed()
    expect(library).toHaveBeenCalledTimes(2)
  })
})
