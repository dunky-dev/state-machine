/**
 * Computed derivations. DISPOSABLE first-look benchmark.
 *
 * `computed` is the most machinery-heavy part of the engine (read-key tracking
 * via proxies, memoization against a snapshot of deps, glitch-free
 * computed→computed chains) and nothing else in the suite touches it. Four
 * measurements, all on ONE machine:
 *
 *   A. CACHED READ — read a computed with NO change since last read. Should be a
 *      cheap memo hit (re-checks deps, returns cached) — the common case.
 *   B. RECOMPUTE   — change the field a computed reads, then read it. The full
 *      recompute path (re-run the def under tracking proxies, re-record deps).
 *   C. CHAIN       — a 4-deep computed→computed chain; change the root, read the
 *      tip. Tests that the chain resolves once per change, not re-run per level.
 *   D. FINE-GRAIN  — change a field the computed does NOT read, then read it.
 *      Read-key tracking should make this a memo hit (no recompute).
 *
 * Cross-engine note: XState has no first-class lazy/memoized computed (you'd
 * recompute in a selector or assign-derived field), so this is core-only — it's
 * an engine-subsystem benchmark, not a competitor table.
 *
 * Exported as `runComputed()`; the suite runs it via benchmark/index.ts.
 */
import { Bench } from 'tinybench'
import { machine } from '@dunky.dev/state-machine'
import { report } from '../report'

const SINK = { n: 0 }

type Ctx = { a: number; b: number; unrelated: number }
type Ev = { type: 'bumpA' | 'bumpUnrelated' }

// A machine with one computed reading `a` + `b`, and a 4-deep chain off `a`.
function makeComputedMachine() {
  return machine<'idle', Ctx, Ev, { sum: number; c1: number; c2: number; c3: number; c4: number }>({
    initial: 'idle',
    context: { a: 0, b: 0, unrelated: 0 },
    computed: {
      sum: ({ context }) => context.a + context.b,
      // chain: each reads the previous computed → a 4-level dependency line
      c1: ({ context }) => context.a + 1,
      c2: ({ computed }) => computed.c1 + 1,
      c3: ({ computed }) => computed.c2 + 1,
      c4: ({ computed }) => computed.c3 + 1,
    },
    states: {
      idle: {
        on: {
          bumpA: { actions: [({ context, setContext }) => setContext({ a: context.a + 1 })] },
          bumpUnrelated: {
            actions: [
              ({ context, setContext }) => setContext({ unrelated: context.unrelated + 1 }),
            ],
          },
        },
      },
    },
  })
}

function benchCachedRead() {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  const m = makeComputedMachine()
  m.start()
  m.send({ type: 'bumpA' }) // prime the cache once
  void m.computed.sum
  bench.add('cached read (no change since last read)', () => {
    SINK.n += m.computed.sum // memo hit: deps unchanged
  })
  return bench
}

function benchRecompute() {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  const m = makeComputedMachine()
  m.start()
  bench.add('recompute (change a read field, then read)', () => {
    m.send({ type: 'bumpA' }) // invalidates `sum` and the chain
    SINK.n += m.computed.sum // full recompute
  })
  return bench
}

function benchChain() {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  const m = makeComputedMachine()
  m.start()
  bench.add('4-deep chain (change root, read tip)', () => {
    m.send({ type: 'bumpA' }) // invalidates c1→c2→c3→c4
    SINK.n += m.computed.c4 // resolves the whole chain
  })
  return bench
}

function benchFineGrain() {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  const m = makeComputedMachine()
  m.start()
  m.send({ type: 'bumpA' })
  void m.computed.sum // prime
  bench.add('fine-grain (change UNREAD field, then read)', () => {
    m.send({ type: 'bumpUnrelated' }) // `sum` doesn't read `unrelated`
    SINK.n += m.computed.sum // should be a memo hit (no recompute)
  })
  return bench
}

async function run(title: string, b: Bench) {
  await b.warmup()
  await b.run()
  report(title, b)
}

export async function runComputed() {
  console.log('\n========== COMPUTED — cache / recompute / chain / fine-grain ==========')
  await run('A. cached read', benchCachedRead())
  await run('B. recompute', benchRecompute())
  await run('C. computed→computed chain (4 deep)', benchChain())
  await run('D. fine-grain (change unread field)', benchFineGrain())
  console.log('(anti-DCE SINK:', SINK.n, ')')
}
