// The shared conformance suite: every mapped binding lands on its declared
// target, and every dropped one lands nowhere.
import { describe, expect, it, vi } from 'vitest'
import type { AttrTargets, HandlerTargets } from '../../src'

type Normalize = (logical: Record<string, unknown>) => Record<string, unknown>

const NONE: ReadonlySet<string> = new Set()

export function describeVocabularyAccounting(
  targetName: string,
  normalize: Normalize,
  handlers: { map: HandlerTargets; dropped?: ReadonlySet<string> },
  attrs: { map: AttrTargets; dropped?: ReadonlySet<string> },
) {
  describe(`${targetName} normalize — vocabulary accounting`, () => {
    it('routes every handler to its declared target; a drop leaks nothing', () => {
      for (const [key, target] of Object.entries(handlers.map) as [string, string][]) {
        const out = normalize({ [key]: vi.fn<(payload?: unknown) => void>() })
        const landed = target in out
        const leaked = target !== key && key in out
        expect({ key, landed, leaked }).toEqual({ key, landed: true, leaked: false })
      }
      for (const key of handlers.dropped ?? NONE) {
        expect(normalize({ [key]: vi.fn<(payload?: unknown) => void>() })).toEqual({})
      }
    })

    it('routes every attr to its declared target; a drop leaks nothing', () => {
      for (const [key, target] of Object.entries(attrs.map) as [string, string][]) {
        const out = normalize({ [key]: key === 'live' ? 'polite' : true })
        const landed = target in out
        const leaked = target !== key && key in out
        expect({ key, landed, leaked }).toEqual({ key, landed: true, leaked: false })
      }
      for (const key of attrs.dropped ?? NONE) {
        expect(normalize({ [key]: true })).toEqual({})
      }
    })
  })
}
