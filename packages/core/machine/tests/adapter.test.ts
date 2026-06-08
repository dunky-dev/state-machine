/**
 * withAdapter — merges a platform adapter's actions + effects over a config's
 * implementations, leaving everything else (notably `delays` and `guards`)
 * intact. The agnostic config stays pure; the platform is applied at the edge.
 */
import { describe, expect, it, vi } from 'vitest'
import { machine, withAdapter } from '../src'
import type { TransitionConfig } from '../src'

type S = 'idle' | 'done'
type C = { ms: number }
type E = { type: 'noop' }

const baseConfig = (): TransitionConfig<S, C, E> => ({
  initial: 'idle',
  context: { ms: 50 },
  states: {
    idle: { after: { wait: { target: 'done' } } },
    done: {},
  },
  implementations: {
    delays: { wait: ({ context }) => context.ms },
    guards: { always: () => true },
  },
})

describe('withAdapter', () => {
  it('carries `delays` through (a named after-delay still resolves)', () => {
    vi.useFakeTimers()
    // The bug this guards: an empty adapter must NOT drop config.delays.
    const m = machine(withAdapter(baseConfig(), {}))
    m.start()
    expect(m.state).toBe('idle')
    vi.advanceTimersByTime(50)
    expect(m.state).toBe('done') // delay resolved → after fired
    m.stop()
    vi.useRealTimers()
  })

  it('keeps guards from the config', () => {
    const merged = withAdapter(baseConfig(), {})
    expect(merged.implementations?.guards?.always).toBeDefined()
    expect(merged.implementations?.delays?.wait).toBeDefined()
  })

  it('layers adapter actions + effects over the config, adapter winning', () => {
    const fromConfig = vi.fn()
    const fromAdapter = vi.fn()
    const config: TransitionConfig<S, C, E> = {
      ...baseConfig(),
      implementations: {
        ...baseConfig().implementations,
        actions: { a: fromConfig, shared: fromConfig },
      },
    }
    const merged = withAdapter(config, { actions: { shared: fromAdapter, b: fromAdapter } })
    expect(merged.implementations?.actions?.a).toBe(fromConfig) // config-only kept
    expect(merged.implementations?.actions?.b).toBe(fromAdapter) // adapter-only added
    expect(merged.implementations?.actions?.shared).toBe(fromAdapter) // adapter wins
  })

  it('does not mutate the input config', () => {
    const config = baseConfig()
    withAdapter(config, { actions: { x: vi.fn() } })
    expect(config.implementations?.actions).toBeUndefined()
  })
})
