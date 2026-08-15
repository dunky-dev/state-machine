// The shared conformance suite: walks a target's ledgers and asserts every
// binding lands on its declared target — or, for a `null` drop, nowhere at all.
import { describe, expect, it, vi } from 'vitest'
import type { AttrTargets, HandlerTargets } from '../../src'

type Normalize = (logical: Record<string, unknown>) => Record<string, unknown>

export function describeVocabularyAccounting(
  targetName: string,
  normalize: Normalize,
  handlers: HandlerTargets,
  attrs: AttrTargets,
) {
  describe(`${targetName} normalize — vocabulary accounting (the translation contract)`, () => {
    it('routes every handler to its declared target; a null drop leaks nothing', () => {
      for (const [key, target] of Object.entries(handlers)) {
        const out = normalize({ [key]: vi.fn<(payload?: unknown) => void>() })
        const landed = target === null ? Object.keys(out).length === 0 : target in out
        const leaked = target !== key && key in out
        expect({ key, landed, leaked }).toEqual({ key, landed: true, leaked: false })
      }
    })

    it('routes every attr to its declared target; a null drop leaks nothing', () => {
      for (const [key, target] of Object.entries(attrs)) {
        const out = normalize({ [key]: key === 'live' ? 'polite' : true })
        const landed = target === null ? Object.keys(out).length === 0 : target in out
        const leaked = target !== key && key in out
        expect({ key, landed, leaked }).toEqual({ key, landed: true, leaked: false })
      }
    })
  })
}
