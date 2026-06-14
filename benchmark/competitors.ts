/**
 * Shared competitor factories for the machine benchmark suite. DISPOSABLE —
 * built for a first look, expect to rebuild.
 *
 * Reactive "cell" models for the HEADLESS tables — the two real STATECHARTS,
 * exposing the same tiny interface so the scenarios can drive them uniformly:
 *
 *   - core   : machine-core   → machine() + select(field).subscribe()  (coarse bus + value-dedup)
 *   - xstate : xstate          → createActor + actor.subscribe (COARSE)  (the real statechart)
 *
 * Both are SYNCHRONOUS, so they share the synchronous ops/sec loop fairly.
 * (@xstate/store is intentionally NOT here — it's a store, not a statechart.)
 *
 * NOTE on what's NOT here:
 *   - xstate's headless subscription (actor.subscribe) is COARSE — fine-grained
 *     selection in XState is `useSelector`, which is React-only; it shows up in
 *     the React render benchmark instead.
 *   - Zag's headless `send` (via @zag-js/vanilla VanillaMachine) is ASYNC —
 *     microtask-batched — so it can't share a synchronous ops/sec loop fairly.
 *     Zag is measured in the React render benchmark only (mount + re-render),
 *     where it runs natively via @zag-js/react.
 */

import { createActor, createMachine as createXMachine, assign } from 'xstate'
import { machine, type Machine } from '@chimba-ui/state-machine'

/** A sink so subscriber work isn't dead-code-eliminated by the JIT. */
export const SINK = { n: 0 }
export const bump = () => {
  SINK.n++
}

export interface Cell {
  /** Change the OBSERVED field (`value`). */
  hit: () => void
  /** Change an UNOBSERVED field (`other`) — for the fine-grain / irrelevant test. */
  miss: () => void
}

// -----------------------------------------------------------------------------
// machine-core cell
// -----------------------------------------------------------------------------
type Ctx = { value: number; other: number }
type Ev = { type: 'hit' | 'miss' }

export function makeCoreMachine(): Machine<'idle', Ctx, Ev> {
  return machine<'idle', Ctx, Ev>({
    initial: 'idle',
    context: { value: 0, other: 0 },
    states: {
      idle: {
        on: {
          hit: { actions: [({ context, setContext }) => setContext({ value: context.value + 1 })] },
          miss: {
            actions: [({ context, setContext }) => setContext({ other: context.other + 1 })],
          },
        },
      },
    },
  })
}

export function makeCoreCell(observe = true): Cell {
  const m = makeCoreMachine()
  m.start()
  if (observe) m.select.context('value').subscribe(bump)
  return { hit: () => m.send({ type: 'hit' }), miss: () => m.send({ type: 'miss' }) }
}

// -----------------------------------------------------------------------------
// xstate cell — the real statechart (createMachine + createActor).
// actor.subscribe is COARSE (fires on every snapshot change). We diff `value`
// in the listener, the same shape the coarse store uses, so the headless number
// reflects XState's actual headless subscription behavior.
// -----------------------------------------------------------------------------
export function makeXstateCell(observe = true): Cell {
  const m = createXMachine({
    context: { value: 0, other: 0 },
    on: {
      hit: { actions: assign({ value: ({ context }) => context.value + 1 }) },
      miss: { actions: assign({ other: ({ context }) => context.other + 1 }) },
    },
  })
  const a = createActor(m)
  a.start()
  if (observe) {
    let last = a.getSnapshot().context.value
    a.subscribe(snap => {
      const v = snap.context.value
      if (v !== last) {
        last = v
        bump()
      }
    })
  }
  return { hit: () => a.send({ type: 'hit' }), miss: () => a.send({ type: 'miss' }) }
}

// -----------------------------------------------------------------------------
// xstate RAW cell — stock `actor.subscribe` with NO hand-built value diff. This
// is what an XState user gets out of the box: the listener fires on EVERY
// snapshot change and (here) does its work unconditionally. We keep it next to
// the diffed `makeXstateCell` so the tables can show both — the diffed row is
// "XState + the same dedup core does for free"; this row is "XState as shipped".
// In the fine-grain (miss) test this is the honest one: stock XState DOES wake
// its subscriber on an unobserved-field change, because it has no per-field
// dedup; only the manual differ (or React's useSelector) suppresses it.
// -----------------------------------------------------------------------------
export function makeXstateRawCell(observe = true): Cell {
  const m = createXMachine({
    context: { value: 0, other: 0 },
    on: {
      hit: { actions: assign({ value: ({ context }) => context.value + 1 }) },
      miss: { actions: assign({ other: ({ context }) => context.other + 1 }) },
    },
  })
  const a = createActor(m)
  a.start()
  if (observe) a.subscribe(() => bump()) // coarse: fires on EVERY change, no diff
  return { hit: () => a.send({ type: 'hit' }), miss: () => a.send({ type: 'miss' }) }
}

export const CONTENDERS: Record<string, (observe?: boolean) => Cell> = {
  core: makeCoreCell,
  xstate: makeXstateCell,
  'xstate-raw': makeXstateRawCell,
}

// -----------------------------------------------------------------------------
// SHARED-FANOUT models — the real fan-out test.
//
// ONE machine/actor whose context holds N fields, with N independent observers,
// each watching ONE field. Bumping field `k` should wake ONLY observer `k`
// (O(changed)), no matter how big N is. This is the structure that actually
// stresses listener-side cost: a coarse "fire all listeners" bus degrades O(N),
// a value-deduped selection layer stays O(changed). The per-cell models above
// can't show this (one machine per cell ⇒ one listener each ⇒ O(1) by
// construction); this one can.
// -----------------------------------------------------------------------------

export interface Fanout {
  /** Mutate field `k` (wakes only observer k under a deduped layer). */
  hit: (k: number) => void
}

function makeWideContext(n: number): Record<string, number> {
  const ctx: Record<string, number> = {}
  for (let i = 0; i < n; i++) ctx[`f${i}`] = 0
  return ctx
}

/**
 * core: one machine, N `select.context('fK')` subscriptions. Each selection
 * re-evaluates on every notify but its listener fires only on a real change of
 * ITS field — so a single-field write wakes exactly one observer's work.
 */
export function makeCoreFanout(n: number): Fanout {
  type FCtx = Record<string, number>
  type FEv = { type: 'set'; key: string }
  const m = machine<'idle', FCtx, FEv>({
    initial: 'idle',
    context: makeWideContext(n),
    states: {
      idle: {
        on: {
          set: {
            actions: [
              ({ context, event, setContext }) =>
                setContext({ [event.key]: context[event.key] + 1 } as Partial<FCtx>),
            ],
          },
        },
      },
    },
  })
  m.start()
  for (let i = 0; i < n; i++) m.select.context(`f${i}`).subscribe(bump)
  return { hit: (k: number) => m.send({ type: 'set', key: `f${k}` }) }
}

/**
 * xstate: one actor, N `useSelector`-shaped observers. @xstate/react's selector
 * is React-only; the headless equivalent is `actor.subscribe` + a per-observer
 * value diff (the same shape XState's own toolkit uses under the hood). So each
 * of the N observers gets its own coarse subscribe that diffs its field — which
 * means every observer's listener still RUNS on every snapshot change. That's
 * exactly the O(N)-listener cost this test is built to expose.
 */
export function makeXstateFanout(n: number): Fanout {
  const m = createXMachine({
    context: makeWideContext(n),
    on: {
      set: {
        actions: assign(({ context, event }) => ({
          [(event as { key: string }).key]: context[(event as { key: string }).key] + 1,
        })),
      },
    },
  })
  const a = createActor(m)
  a.start()
  for (let i = 0; i < n; i++) {
    const key = `f${i}`
    let last = a.getSnapshot().context[key]
    a.subscribe(snap => {
      const v = snap.context[key]
      if (v !== last) {
        last = v
        bump()
      }
    })
  }
  return { hit: (k: number) => a.send({ type: 'set', key: `f${k}` }) }
}
