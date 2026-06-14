/**
 * compose — run several independent machines as one unit (orthogonal regions).
 * Bundled lifecycle (start/stop fan out), `sync` for cross-region rules, and
 * `combine` for one value-deduped Selection across members. Built on the
 * single-machine surface; members stay independent peers.
 */
import { compose, machine } from '../src'
import { describe, expect, it, vi } from 'vitest'

const popupConfig = {
  initial: 'closed' as const,
  context: {},
  states: {
    closed: { on: { focus: { target: 'open' as const } } },
    open: { on: { escape: { target: 'closed' as const } } },
  },
}
const submenuConfig = {
  initial: 'none' as const,
  context: {},
  states: {
    none: { on: { open: { target: 'shown' as const } } },
    shown: { on: { close: { target: 'none' as const } } },
  },
}

describe('compose — lifecycle', () => {
  it('start() starts every member; members are reachable by name', () => {
    const log: string[] = []
    const a = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [() => void log.push('a')] } },
    })
    const b = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [() => void log.push('b')] } },
    })
    const group = compose({ a, b })
    expect(log).toEqual([]) // built stopped
    group.start()
    expect(log).toEqual(['a', 'b']) // started in declared order
    expect(group.members.a).toBe(a)
  })

  it('stop() stops members in reverse order (cleanups)', () => {
    const log: string[] = []
    const a = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [() => () => log.push('a:cleanup')] } },
    })
    const b = machine<'idle', object, { type: 'noop' }>({
      initial: 'idle',
      context: {},
      states: { idle: { effects: [() => () => log.push('b:cleanup')] } },
    })
    const group = compose({ a, b })
    group.start()
    group.stop()
    expect(log).toEqual(['b:cleanup', 'a:cleanup']) // reverse
  })

  it('members stay independent — each driven on its own', () => {
    const popup = machine<'closed' | 'open', object, { type: 'focus' | 'escape' }>(popupConfig)
    const submenu = machine<'none' | 'shown', object, { type: 'open' | 'close' }>(submenuConfig)
    const group = compose({ popup, submenu })
    group.start()
    popup.send({ type: 'focus' })
    submenu.send({ type: 'open' }) // both active simultaneously
    expect(popup.state).toBe('open')
    expect(submenu.state).toBe('shown')
  })
})

describe('compose — sync', () => {
  it('reacts when any member changes; not on setup', () => {
    const popup = machine<'closed' | 'open', object, { type: 'focus' | 'escape' }>(popupConfig)
    const submenu = machine<'none' | 'shown', object, { type: 'open' | 'close' }>(submenuConfig)
    const group = compose({ popup, submenu })
    group.start()
    popup.send({ type: 'focus' })
    submenu.send({ type: 'open' })

    // rule: whenever popup is closed, close the submenu too
    group.sync(() => {
      if (popup.matches('closed')) submenu.send({ type: 'close' })
    })
    expect(submenu.state).toBe('shown') // no fire on setup

    popup.send({ type: 'escape' }) // popup → closed → sync fires → submenu closes
    expect(submenu.state).toBe('none')
  })

  it('a sync rule is disposed on stop()', () => {
    const popup = machine<'closed' | 'open', object, { type: 'focus' | 'escape' }>(popupConfig)
    const submenu = machine<'none' | 'shown', object, { type: 'open' | 'close' }>(submenuConfig)
    const group = compose({ popup, submenu })
    group.start()
    const fn = vi.fn()
    group.sync(fn)
    popup.send({ type: 'focus' })
    expect(fn).toHaveBeenCalledTimes(1)
    group.stop()
    // restart members so they still transition, but the sync rule is gone
    popup.start()
    popup.send({ type: 'escape' })
    expect(fn).toHaveBeenCalledTimes(1) // not called again after stop
  })

  it('the returned disposer stops the rule early', () => {
    const popup = machine<'closed' | 'open', object, { type: 'focus' | 'escape' }>(popupConfig)
    const submenu = machine<'none' | 'shown', object, { type: 'open' | 'close' }>(submenuConfig)
    const group = compose({ popup, submenu })
    group.start()
    const fn = vi.fn()
    const off = group.sync(fn)
    popup.send({ type: 'focus' })
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    popup.send({ type: 'escape' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('compose — combine', () => {
  it('derives one value across members; .value reads current', () => {
    const popup = machine<'closed' | 'open', object, { type: 'focus' | 'escape' }>(popupConfig)
    const submenu = machine<'none' | 'shown', object, { type: 'open' | 'close' }>(submenuConfig)
    const group = compose({ popup, submenu })
    group.start()
    const view = group.combine(() => ({ open: popup.matches('open'), sub: submenu.state }))
    expect(view.value).toEqual({ open: false, sub: 'none' })
    popup.send({ type: 'focus' })
    submenu.send({ type: 'open' })
    expect(view.value).toEqual({ open: true, sub: 'shown' })
  })

  it('subscribe fires only when the combined value changes (deduped)', () => {
    const popup = machine<'closed' | 'open', object, { type: 'focus' | 'escape' }>(popupConfig)
    const submenu = machine<'none' | 'shown', object, { type: 'open' | 'close' }>(submenuConfig)
    const group = compose({ popup, submenu })
    group.start()
    // selects ONLY popup's open-ness; submenu changes must not fire it
    const isOpen = group.combine(() => popup.matches('open'))
    const fn = vi.fn()
    isOpen.subscribe(fn)
    submenu.send({ type: 'open' }) // submenu changed, selected value (popup open) didn't → silent
    expect(fn).not.toHaveBeenCalled()
    popup.send({ type: 'focus' }) // popup open false→true → fires
    expect(fn).toHaveBeenLastCalledWith(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a combine subscription is disposed on stop()', () => {
    const popup = machine<'closed' | 'open', object, { type: 'focus' | 'escape' }>(popupConfig)
    const submenu = machine<'none' | 'shown', object, { type: 'open' | 'close' }>(submenuConfig)
    const group = compose({ popup, submenu })
    group.start()
    const fn = vi.fn()
    group.combine(() => popup.state).subscribe(fn)
    popup.send({ type: 'focus' })
    expect(fn).toHaveBeenCalledTimes(1)
    group.stop()
    popup.start()
    popup.send({ type: 'escape' })
    expect(fn).toHaveBeenCalledTimes(1) // disposed
  })
})

// Regression coverage for the cross-region feedback the benchmark suite found
// (see benchmark/tests/compose.ts NOTE — a sync rule that send()s downstream).
// `sync` subscribes to EVERY member, including any it writes to, so a reaction
// that sends to a member re-triggers itself when that send notifies. The rule
// MUST damp its own forward (only send when it would actually change something),
// or it re-enters without bound. These pin both halves: damped converges with a
// bounded call count; undamped is the caller's bug, not the engine's.
describe('compose — cross-region sync that sends downstream', () => {
  const counter = {
    initial: 'idle' as const,
    context: { n: 0 },
    states: {
      idle: {
        on: {
          hit: {
            actions: [
              ({
                context,
                setContext,
              }: {
                context: { n: number }
                setContext: (p: Partial<{ n: number }>) => void
              }) => setContext({ n: context.n + 1 }),
            ],
          },
        },
      },
    },
  }

  it('a DAMPED forward (send only when it changes b) converges with O(ops) sync calls', () => {
    const a = machine<'idle', { n: number }, { type: 'hit' }>(counter)
    const b = machine<'idle', { n: number }, { type: 'hit' }>(counter)
    const g = compose({ a, b })
    g.start()
    let syncCalls = 0
    // damper: only forward while b is behind a → reaches a fixpoint, no runaway
    g.sync(() => {
      syncCalls++
      if (a.context.n > b.context.n) b.send({ type: 'hit' })
    })

    const OPS = 200
    for (let i = 0; i < OPS; i++) a.send({ type: 'hit' })

    expect(a.context.n).toBe(OPS)
    expect(b.context.n).toBe(OPS) // b kept in lock-step
    // Each a.hit fires sync once (a changed) + b.hit fires it once more (b changed)
    // = exactly 2 per op. The key assertion: it's LINEAR, not superlinear.
    expect(syncCalls).toBe(OPS * 2)
  })

  it('re-entrant send from sync is queued, not run mid-drain (state stays consistent)', () => {
    const a = machine<'idle', { n: number }, { type: 'hit' }>(counter)
    const b = machine<'idle', { n: number }, { type: 'hit' }>(counter)
    const g = compose({ a, b })
    g.start()
    g.sync(() => {
      if (a.context.n > b.context.n) b.send({ type: 'hit' })
    })
    a.send({ type: 'hit' })
    // b's send happens via sync during a's notify; b's own queue drains it cleanly
    expect(a.context.n).toBe(1)
    expect(b.context.n).toBe(1)
  })
})
