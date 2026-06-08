/**
 * config() — the authoring helper.
 *
 * Pins: config(c) returns the same object, typed; the result feeds machine()
 * with inferred State/Context/Event (narrow .state / .context); and it
 * type-checks the literal at the definition site (a bad `target` errors).
 */
import { describe, expect, it } from 'vitest'
import { config, machine } from '../src'

describe('config()', () => {
  it('returns the config unchanged and feeds machine() with inferred types', () => {
    const cfg = config({
      initial: 'closed',
      context: { count: 0 },
      states: {
        closed: { on: { open: { target: 'open' } } },
        open: { on: { close: { target: 'closed' } } },
      },
    })

    const m = machine(cfg)
    m.start()
    expect(m.state).toBe('closed')

    // inferred narrow types — these annotations compile:
    const s: 'closed' | 'open' = m.state
    const n: number = m.context.count
    expect([s, n]).toEqual(['closed', 0])

    m.send({ type: 'open' })
    expect(m.state).toBe('open')
  })

  it('type-checks the literal: an invalid target errors AT the target', () => {
    // State is inferred ONLY from the `states` keys (NoInfer guards `target` /
    // `initial`), so a bad target is checked against the declared states and
    // errors right at the target — and `target` autocompletes 'a' | 'b'.
    config({
      initial: 'a',
      context: {},
      states: {
        // @ts-expect-error 'nope' is not 'a' | 'b'
        a: { on: { go: { target: 'nope' } } },
        b: {},
      },
    })
    expect(true).toBe(true) // the assertion is the @ts-expect-error above
  })

  it('type-checks the literal: a misspelled top-level key is a compile error', () => {
    config({
      // @ts-expect-error 'initiel' is not a config key (and 'initial' is missing)
      initiel: 'a',
      context: {},
      states: { a: {} },
    })
    expect(true).toBe(true)
  })
})
