/**
 * Round 6 (decision A) — effects: run on enter, cleanup on exit.
 *
 * Pins the mechanism and the bookend ordering: starting an effect runs its
 * body and stashes the returned cleanup; the cleanup runs FIRST on exit
 * (before exit actions); inline + named effects both resolve; a missing name
 * throws in dev. Initial-state-at-boot behavior is decision B (next commit) —
 * these tests transition INTO a state to observe start.
 */
import { describe, expect, it } from 'vitest'
import { createTransitions } from '../src/machine'

describe('R6a — effects (enter → cleanup on exit)', () => {
  it('runs the effect body on enter and its cleanup on exit', () => {
    const log: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' | 'toA' }>({
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
    m.send({ type: 'toB' })
    expect(log).toEqual(['start:b']) // body ran on enter; no cleanup yet
    m.send({ type: 'toA' })
    expect(log).toEqual(['start:b', 'cleanup:b']) // cleanup ran on exit
  })

  it('cleanup runs BEFORE exit actions (bookend / decision A)', () => {
    const order: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' | 'toA' }>({
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
    m.send({ type: 'toB' })
    m.send({ type: 'toA' })
    expect(order).toEqual(['cleanup', 'exit-action'])
  })

  it('start runs AFTER entry actions (mirror bookend on enter)', () => {
    const order: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' }>({
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
    m.send({ type: 'toB' })
    expect(order).toEqual(['entry-action', 'start'])
  })

  it('an effect returning nothing is fine (no cleanup stashed)', () => {
    const log: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' | 'toA' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: { effects: [() => void log.push('fire-and-forget')], on: { toA: { target: 'a' } } },
      },
    })
    m.send({ type: 'toB' })
    m.send({ type: 'toA' }) // exit must not throw despite no cleanup
    expect(log).toEqual(['fire-and-forget'])
    expect(m.state).toBe('a')
  })

  it('resolves a named effect from implementations.effects', () => {
    const log: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' | 'toA' }>({
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
    m.send({ type: 'toB' })
    m.send({ type: 'toA' })
    expect(log).toEqual(['watch:start', 'watch:cleanup'])
  })

  it('multiple effects clean up together on exit', () => {
    const log: string[] = []
    const m = createTransitions<'a' | 'b', object, { type: 'toB' | 'toA' }>({
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
    m.send({ type: 'toB' })
    m.send({ type: 'toA' })
    expect(log).toEqual(['c1', 'c2'])
  })

  it('throws in dev when an effect name is not registered', () => {
    const m = createTransitions<'a' | 'b', object, { type: 'toB' }>({
      initial: 'a',
      context: {},
      states: {
        a: { on: { toB: { target: 'b' } } },
        b: { effects: ['missing'] },
      },
    })
    expect(() => m.send({ type: 'toB' })).toThrow(/no effect "missing"/)
  })

  it('an effect can read context/event and queue events via send', () => {
    const seen: string[] = []
    const m = createTransitions<'a' | 'b', { label: string }, { type: 'toB' | 'mark' }>({
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
    m.send({ type: 'toB' })
    expect(seen).toEqual(['hello', 'marked'])
  })
})
