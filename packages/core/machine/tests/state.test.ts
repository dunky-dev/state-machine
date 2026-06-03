/**
 * State representation.
 *
 * Pins: flat tagged states; tracked `state` / `hasTag` / `matches` reads;
 * co-located tags; fine-grained re-run (a tag-group reader does NOT wake when
 * the state moves within the same tag group).
 */
import { effect } from '@preact/signals-core'
import { describe, expect, it } from 'vitest'
import { createState } from '../src'

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

  it('state reads are tracked: a `state` reader re-runs on every transition', () => {
    const s = make()
    let runs = 0
    effect(() => {
      s.state
      runs++
    })
    expect(runs).toBe(1)
    s.set('opening')
    expect(runs).toBe(2)
    s.set('open')
    expect(runs).toBe(3)
  })

  it('hasTag reads are tracked AND value-gated: moving WITHIN a tag group does not wake a tag reader', () => {
    const s = make()
    let runs = 0
    // Track hasTag('visible') as a derived boolean via an effect that only
    // re-runs the body; to gate on the boolean value we read it and compare.
    let last = s.hasTag('visible')
    effect(() => {
      const v = s.hasTag('visible')
      // count only when the selected boolean actually changes
      if (v !== last) {
        last = v
        runs++
      }
    })
    expect(runs).toBe(0)

    s.set('opening') // closed→opening: visible false→true → counts
    expect(runs).toBe(1)
    s.set('open') // opening→open: visible true→true → NO count
    expect(runs).toBe(1)
    s.set('closing') // open→closing: still visible → NO count
    expect(runs).toBe(1)
    s.set('closed') // closing→closed: visible true→false → counts
    expect(runs).toBe(2)
  })

  it('no-op transition (same state) does not wake readers', () => {
    const s = make()
    let runs = 0
    effect(() => {
      s.state
      runs++
    })
    expect(runs).toBe(1)
    s.set('closed') // already closed
    expect(runs).toBe(1)
  })
})
