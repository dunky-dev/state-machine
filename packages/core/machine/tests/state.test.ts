/**
 * State representation.
 *
 * Pins: flat tagged states; plain `state` / `hasTag` / `matches` reads;
 * co-located tags; a real transition notifies, a no-op (same state) does not.
 * Value-gating ("a tag-group reader doesn't wake moving within the group") is a
 * property of `select`, verified in subscribe.test.ts — createState just notifies
 * on a real state change.
 */
import { describe, expect, it, vi } from 'vitest'
import { createState } from '../src/state'

const make = () =>
  createState('closed', {
    closed: { tags: [] },
    opening: { tags: ['visible'] },
    open: { tags: ['visible'] },
    closing: { tags: ['visible'] },
  })

describe('createState', () => {
  it('exposes the current state string', () => {
    const s = make()
    expect(s.state).toBe('closed')
    s.set('open')
    expect(s.state).toBe('open')
  })

  it('matches() is exact-state equality', () => {
    const s = make()
    s.set('open')
    expect(s.matches('open')).toBe(true)
    expect(s.matches('closing')).toBe(false)
  })

  it('hasTag() reflects the current state’s co-located tags', () => {
    const s = make()
    expect(s.hasTag('visible')).toBe(false) // closed
    s.set('opening')
    expect(s.hasTag('visible')).toBe(true)
    s.set('open')
    expect(s.hasTag('visible')).toBe(true)
    s.set('closed')
    expect(s.hasTag('visible')).toBe(false)
  })

  it('a real transition notifies once per change', () => {
    const notify = vi.fn()
    const s = createState(
      'closed',
      { closed: { tags: [] }, opening: { tags: ['visible'] }, open: { tags: ['visible'] } },
      notify,
    )
    s.set('opening')
    expect(notify).toHaveBeenCalledTimes(1)
    s.set('open')
    expect(notify).toHaveBeenCalledTimes(2)
    // reads reflect the new state + tags
    expect(s.state).toBe('open')
    expect(s.hasTag('visible')).toBe(true)
  })

  it('no-op transition (same state) does not notify', () => {
    const notify = vi.fn()
    const s = createState('closed', { closed: { tags: [] } }, notify)
    s.set('closed') // already closed
    expect(notify).not.toHaveBeenCalled()
  })
})
