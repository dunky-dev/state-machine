/**
 * Effects — state-scoped side-effects with cleanup. Run on enter, return an
 * optional cleanup run on exit; cleanup bookends first on exit, start last on
 * enter. The initial state's effects boot on start(); withAdapter swaps the
 * named implementations per platform.
 */
import { machine, MACHINE_INIT, withAdapter } from '../src'
import { describe, expect, it } from 'vitest'

describe('enter → cleanup on exit', () => {
  it('runs the effect body on enter and its cleanup on exit', () => {
    const log: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' | 'toA' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: {
          effects: [
            () => {
              log.push('start:b')
              return () => log.push('cleanup:b')
            },
          ],
          on: { toA: { target: 'a' } },
        },
      },
    })
    m.start()
    m.send({ type: 'toB' })
    expect(log).toEqual(['start:b']) // body ran on enter; no cleanup yet
    m.send({ type: 'toA' })
    expect(log).toEqual(['start:b', 'cleanup:b']) // cleanup ran on exit
  })

  it('cleanup runs BEFORE exit actions (bookend)', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' | 'toA' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: {
          effects: [() => () => order.push('cleanup')],
          exit: [() => order.push('exit-action')],
          on: { toA: { target: 'a' } },
        },
      },
    })
    m.start()
    m.send({ type: 'toB' })
    m.send({ type: 'toA' })
    expect(order).toEqual(['cleanup', 'exit-action'])
  })

  it('start runs AFTER entry actions (mirror bookend on enter)', () => {
    const order: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: {
          entry: [() => order.push('entry-action')],
          effects: [
            () => {
              order.push('start')
            },
          ],
        },
      },
    })
    m.start()
    m.send({ type: 'toB' })
    expect(order).toEqual(['entry-action', 'start'])
  })

  it('an effect returning nothing is fine (no cleanup stashed)', () => {
    const log: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' | 'toA' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: { effects: [() => void log.push('fire-and-forget')], on: { toA: { target: 'a' } } },
      },
    })
    m.start()
    m.send({ type: 'toB' })
    m.send({ type: 'toA' }) // exit must not throw despite no cleanup
    expect(log).toEqual(['fire-and-forget'])
    expect(m.state).toBe('a')
  })

  it('resolves a named effect from implementations.effects', () => {
    const log: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' | 'toA' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: { effects: ['watch'], on: { toA: { target: 'a' } } },
      },
      implementations: {
        effects: {
          watch: () => {
            log.push('watch:start')
            return () => log.push('watch:cleanup')
          },
        },
      },
    })
    m.start()
    m.send({ type: 'toB' })
    m.send({ type: 'toA' })
    expect(log).toEqual(['watch:start', 'watch:cleanup'])
  })

  it('multiple effects clean up together on exit', () => {
    const log: string[] = []
    const m = machine<'a' | 'b', object, { type: 'toB' | 'toA' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: {
          effects: [() => () => log.push('c1'), () => () => log.push('c2')],
          on: { toA: { target: 'a' } },
        },
      },
    })
    m.start()
    m.send({ type: 'toB' })
    m.send({ type: 'toA' })
    expect(log).toEqual(['c1', 'c2'])
  })

  it('throws in dev when an effect name is not registered', () => {
    const m = machine<'a' | 'b', object, { type: 'toB' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: { effects: ['missing'] },
      },
    })
    m.start()
    expect(() => m.send({ type: 'toB' })).toThrow(/no effect "missing"/)
  })

  it('an effect can read context/event and queue events via send', () => {
    const seen: string[] = []
    const m = machine<'a' | 'b', { label: string }, { type: 'toB' | 'mark' }>({
      initial: 'a',
      context: { label: 'hello' },
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: {
          effects: [
            ({ context, send }) => {
              seen.push(context.label)
              send({ type: 'mark' })
            },
          ],
          on: { mark: { actions: [() => seen.push('marked')] } },
        },
      },
    })
    m.start()
    m.send({ type: 'toB' })
    expect(seen).toEqual(['hello', 'marked'])
  })
})

describe('initial-state effects at start', () => {
  it('does NOT start effects at construction; starts them on start()', () => {
    const log: string[] = []
    const m = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [() => void log.push('start:idle')] } },
    })
    expect(log).toEqual([]) // built but stopped → no effects yet
    m.start()
    expect(log).toEqual(['start:idle']) // boot on start, no send needed
  })

  it('the boot event is MACHINE_INIT', () => {
    let seenType: string | undefined
    const m = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          effects: [
            ({ event }) => {
              seenType = event.type
            },
          ],
        },
      },
    })
    m.start()
    expect(seenType).toBe(MACHINE_INIT)
    expect(MACHINE_INIT).toBe('machine.init')
  })

  it('cleanup of the initial effect runs on the first transition out', () => {
    const log: string[] = []
    const m = machine<'idle' | 'gone', object, { type: 'leave' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          effects: [
            () => {
              log.push('start')
              return () => log.push('cleanup')
            },
          ],
          on: { leave: { target: 'gone' } },
        },
        gone: {},
      },
    })
    m.start()
    expect(log).toEqual(['start']) // started on start()
    m.send({ type: 'leave' })
    expect(log).toEqual(['start', 'cleanup']) // cleaned up leaving idle
  })

  it('stop() runs the active effect cleanups', () => {
    const log: string[] = []
    const m = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [() => () => log.push('cleanup')] } },
    })
    m.start()
    m.stop()
    expect(log).toEqual(['cleanup'])
  })

  it('is restartable — start after stop re-boots the initial effect', () => {
    const log: string[] = []
    const m = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          effects: [
            () => {
              log.push('start')
              return () => log.push('cleanup')
            },
          ],
        },
      },
    })
    m.start()
    m.stop()
    m.start()
    expect(log).toEqual(['start', 'cleanup', 'start'])
  })

  it('entry of the initial state still does NOT fire on start (the divergence)', () => {
    const log: string[] = []
    const m = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: {
        idle: {
          entry: [() => log.push('entry')],
          effects: [() => void log.push('effect')],
        },
      },
    })
    m.start()
    // effect starts on start; entry does not — only effects start the resting state
    expect(log).toEqual(['effect'])
  })

  it('an effect can read context at start', () => {
    let seen: number | undefined
    const m = machine<'idle', { count: number }, { type: 'noop' }>({
      initial: 'idle',
      context: { count: 7 },
      states: {
        idle: {
          effects: [
            ({ context }) => {
              seen = context.count
            },
          ],
        },
      },
    })
    m.start()
    expect(seen).toBe(7)
  })
})

type Ctx = { disabled: boolean }
type Ev = { type: 'open' | 'close' }

// Agnostic base: names everything, implements only the pure guard.
const baseConfig = {
  initial: 'closed' as const,
  context: { disabled: false },
  states: {
    closed: { on: { open: { target: 'open' as const, guard: 'canOpen' } } },
    open: {
      entry: ['focusFirstItem'],
      effects: ['trackOutsideClick'],
      on: { close: { target: 'closed' as const } },
    },
  },
  implementations: { guards: { canOpen: ({ context }: { context: Ctx }) => !context.disabled } },
}

describe('withAdapter — per-platform implementations', () => {
  it('injects platform effects + actions by name', () => {
    const log: string[] = []
    const domAdapter = {
      actions: { focusFirstItem: () => log.push('dom:focus') },
      effects: {
        trackOutsideClick: () => {
          log.push('dom:track:start')
          return () => log.push('dom:track:cleanup')
        },
      },
    }
    const m = machine<'closed' | 'open', Ctx, Ev>(withAdapter(baseConfig, domAdapter))
    m.start()
    m.send({ type: 'open' }) // canOpen passes → entry focuses, effect starts
    expect(log).toEqual(['dom:focus', 'dom:track:start'])
    m.send({ type: 'close' }) // effect cleanup runs first on exit
    expect(log).toEqual(['dom:focus', 'dom:track:start', 'dom:track:cleanup'])
  })

  it('the same agnostic config drives two different platforms', () => {
    const log: string[] = []
    const dom = {
      actions: { focusFirstItem: () => log.push('dom') },
      effects: { trackOutsideClick: () => {} },
    }
    const canvas = {
      actions: { focusFirstItem: () => log.push('canvas') },
      effects: { trackOutsideClick: () => {} },
    }

    machine<'closed' | 'open', Ctx, Ev>(withAdapter(baseConfig, dom)).send({
      type: 'open',
    })
    machine<'closed' | 'open', Ctx, Ev>(withAdapter(baseConfig, canvas)).send({
      type: 'open',
    })
    expect(log).toEqual(['dom', 'canvas'])
  })

  it('adapter wins over a config-provided default on name collision', () => {
    const log: string[] = []
    const configWithDefault = {
      ...baseConfig,
      implementations: {
        guards: baseConfig.implementations.guards,
        actions: { focusFirstItem: () => log.push('default') }, // config default
        effects: { trackOutsideClick: () => {} },
      },
    }
    const adapter = { actions: { focusFirstItem: () => log.push('platform') } }
    machine<'closed' | 'open', Ctx, Ev>(withAdapter(configWithDefault, adapter)).send({
      type: 'open',
    })
    expect(log).toEqual(['platform']) // adapter overrode the config default
  })

  it('preserves config guards (adapter does not touch them)', () => {
    const m = machine<'closed' | 'open', Ctx, Ev>(
      withAdapter(
        { ...baseConfig, context: { disabled: true } as Ctx },
        { actions: { focusFirstItem: () => {} }, effects: { trackOutsideClick: () => {} } },
      ),
    )
    m.send({ type: 'open' }) // canOpen=false (disabled) → blocked, still 'closed'
    expect(m.state).toBe('closed')
  })

  it('does not mutate the input config', () => {
    const before = baseConfig.implementations
    withAdapter(baseConfig, { actions: { focusFirstItem: () => {} } })
    expect(baseConfig.implementations).toBe(before) // same ref, untouched
    expect('actions' in baseConfig.implementations).toBe(false) // no actions leaked in
  })

  it('an adapter may supply only effects (actions optional) and vice-versa', () => {
    const log: string[] = []
    const cfg = {
      initial: 'a' as const,
      context: {},
      states: {
        a: { effects: ['e'], on: { go: { target: 'b' as const } } },
        b: {},
      },
    }
    const m = machine<'a' | 'b', object, { type: 'go' }>(
      withAdapter(cfg, { effects: { e: () => void log.push('e') } }), // no actions key
    )
    m.start()
    expect(log).toEqual(['e']) // start booted the initial effect
  })
})
