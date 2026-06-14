/**
 * Engine hot paths the rest of the suite never touches. DISPOSABLE first-look.
 *
 * Everything else stays in `idle` and only mutates context. These exercise the
 * parts of `send` that actually do statechart work:
 *
 *   A. GUARDS       — a transition with K guarded candidates where the LAST one
 *      wins. Times the resolve() fallthrough (build params once, test guards in
 *      order). Scaled by K to see candidate-list cost.
 *   B. TRANSITIONS  — a machine that actually CHANGES STATE every event:
 *      exit actions → transition actions → switch → entry actions. The
 *      exit/entry-action path that a context-only mutate never runs.
 *   C. EFFECT CHURN — same, but each state boots an effect on entry and runs its
 *      cleanup on exit. Times startEffects/stopEffects per transition.
 *   D. SUB CHURN    — the bus-snapshot rebuild path: subscribe + immediately
 *      unsubscribe around each event, so `busDirty` flips every notify and
 *      `busSnapshot` is re-derived (the mount/unmount-storm shape of a
 *      virtualized 5k list). Contrast with a stable subscriber set (no rebuild).
 *
 * Core-only — these are engine-subsystem measurements, not a competitor table.
 *
 * Exported as `runEngine()`; the suite runs it via benchmark/index.ts.
 */
import { Bench } from 'tinybench'
import { machine } from '@chimba-ui/state-machine'
import { report } from '../report'

const SINK = { n: 0 }
const bump = () => {
  SINK.n++
}

// --- A. guard fallthrough: K candidates, the LAST passes ---
function benchGuards(K: number) {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  // K candidates for `go`: the first K-1 guards fail, the last passes. resolve()
  // walks the list testing guards until one passes.
  const candidates = Array.from({ length: K }, (_, i) => ({
    guard: ({ context }: { context: { pick: number } }) => context.pick === i,
    actions: [() => bump()],
  }))
  const m = machine<'idle', { pick: number }, { type: 'go' }>({
    initial: 'idle',
    context: { pick: K - 1 }, // force the LAST candidate to win → full walk
    states: { idle: { on: { go: candidates } } },
  })
  m.start()
  bench.add(`guards — ${K} candidates, last wins`, () => m.send({ type: 'go' }))
  return bench
}

// --- B. real state churn: ping ↔ pong, entry/exit actions each transition ---
function benchTransitions() {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  const m = machine<'ping' | 'pong', { n: number }, { type: 'go' }>({
    initial: 'ping',
    context: { n: 0 },
    states: {
      ping: {
        entry: [() => bump()],
        exit: [() => bump()],
        on: { go: { target: 'pong' } },
      },
      pong: {
        entry: [() => bump()],
        exit: [() => bump()],
        on: { go: { target: 'ping' } },
      },
    },
  })
  m.start()
  bench.add('state churn — exit+entry actions every event', () => m.send({ type: 'go' }))
  return bench
}

// --- C. effect churn: each state boots an effect on entry, cleans up on exit ---
function benchEffectChurn() {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  const m = machine<'ping' | 'pong', { n: number }, { type: 'go' }>({
    initial: 'ping',
    context: { n: 0 },
    states: {
      ping: {
        effects: [
          () => {
            bump()
            return () => bump() // cleanup on exit
          },
        ],
        on: { go: { target: 'pong' } },
      },
      pong: {
        effects: [
          () => {
            bump()
            return () => bump()
          },
        ],
        on: { go: { target: 'ping' } },
      },
    },
  })
  m.start()
  bench.add('effect churn — boot+cleanup every transition', () => m.send({ type: 'go' }))
  return bench
}

// --- D. subscriber churn vs stable set: does the bus-snapshot rebuild bite? ---
function benchSubChurn() {
  const bench = new Bench({ time: 500, warmupTime: 100 })

  // Stable: a fixed subscriber set, so busSnapshot is built once and reused.
  {
    const m = machine<'idle', { n: number }, { type: 'hit' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: { hit: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })
    m.start()
    for (let i = 0; i < 8; i++) m.subscribe(bump) // stable members
    bench.add('sub churn — STABLE set (no snapshot rebuild)', () => m.send({ type: 'hit' }))
  }

  // Churn: subscribe + unsubscribe around each event, so busDirty flips every
  // notify and busSnapshot is re-derived — the virtualized-list mount/unmount shape.
  {
    const m = machine<'idle', { n: number }, { type: 'hit' }>({
      initial: 'idle',
      context: { n: 0 },
      states: {
        idle: {
          on: { hit: { actions: [({ context, setContext }) => setContext({ n: context.n + 1 })] } },
        },
      },
    })
    m.start()
    for (let i = 0; i < 8; i++) m.subscribe(bump)
    bench.add('sub churn — CHURNING set (snapshot rebuilt each notify)', () => {
      const off = m.subscribe(bump) // membership change → busDirty
      m.send({ type: 'hit' }) // rebuilds busSnapshot, then notifies
      off() // membership change again
    })
  }

  return bench
}

async function run(title: string, b: Bench) {
  await b.warmup()
  await b.run()
  report(title, b)
}

export async function runEngine() {
  console.log('\n========== ENGINE — guards / transitions / effects / sub churn ==========')
  for (const K of [2, 8, 32]) await run(`A. guard fallthrough (${K} candidates)`, benchGuards(K))
  await run('B. state-change churn', benchTransitions())
  await run('C. effect boot/cleanup churn', benchEffectChurn())
  await run('D. subscriber churn vs stable', benchSubChurn())
  console.log('(anti-DCE SINK:', SINK.n, ')')
}
