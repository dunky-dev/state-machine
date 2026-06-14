/* eslint-disable no-unused-vars -- `i` is read via `i++` inside the bench
   closures; oxlint's no-unused-vars can't see the closure read. */
/**
 * Fan-out + fine-grain + throughput. DISPOSABLE first-look benchmark.
 *
 *   A. PROPAGATION  — ONE machine, N fields, N observers (one per field). Bump
 *      ONE field. This exposes the cost of the SELECTION layer at scale. Core's
 *      `select` is a coarse bus: every selection re-evaluates its selector on
 *      every notify and value-compares, so only the touched field's LISTENER
 *      fires (O(changed) downstream) — but the re-eval pass itself is O(N
 *      observers) per write. So expect this to degrade with N for core; the
 *      question the table answers is HOW it degrades vs xstate's coarse
 *      `actor.subscribe` (also O(N) here, with a heavier per-notify constant).
 *      (Per-cell-machine setups can't test this — one machine per cell is O(1)
 *      by construction, which is why the old version couldn't show fan-out.)
 *   B. FINE-GRAIN   — change a field NOBODY observes. The dedup layer re-evals
 *      its selector and value-compares, so NO observer's listener fires — the
 *      subscriber-side work is ~zero (the engine still pays one bus pass).
 *   C. THROUGHPUT   — one cell, fire one event. Per-transition cost (where the
 *      coarse bus may LOSE to a plain store reducer).
 *
 * Contenders (both SYNCHRONOUS statecharts, so the ops/sec loop is fair): core,
 * xstate (real statechart, coarse headless subscribe).
 *
 * Not here: Zag — its headless `send` is async/microtask-batched, so it can't
 * share a synchronous loop. Zag is in the React render benchmark instead.
 *
 * Exported as `runFanout()`; the suite runs it via benchmark/index.ts
 * (`pnpm benchmark`).
 */
import { Bench } from 'tinybench'
import {
  makeCoreCell,
  makeXstateCell,
  makeXstateRawCell,
  makeCoreFanout,
  makeXstateFanout,
  SINK,
  type Cell,
  type Fanout,
} from '../competitors'
import { report } from '../report'

// `xstate` diffs `value` in its listener (the same dedup core does for free);
// `xstate-raw` is stock `actor.subscribe` (fires unconditionally, no diff) — so
// the fine-grain (miss) table shows BOTH: what XState does out of the box vs.
// with a hand-built differ.
const CONTENDERS: Array<[string, (observe?: boolean) => Cell]> = [
  ['core      ', makeCoreCell],
  ['xstate    ', makeXstateCell],
  ['xstate-raw', makeXstateRawCell],
]

const FANOUT_CONTENDERS: Array<[string, (n: number) => Fanout]> = [
  ['core  ', makeCoreFanout],
  ['xstate', makeXstateFanout],
]

// A. ONE machine, N observers, bump ONE field per op (rotating which field so no
// single field's value stays hot). Only the deduped layer keeps this O(changed):
// the listener for the touched field fires, the other N-1 don't.
function benchPropagation(N: number) {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  for (const [label, make] of FANOUT_CONTENDERS) {
    const f = make(N)
    let i = 0
    bench.add(`${label} 1/${N}`, () => {
      f.hit(i++ % N)
    })
  }
  return bench
}

function benchFineGrain(N: number) {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  for (const [label, make] of CONTENDERS) {
    const cells = Array.from({ length: N }, () => make())
    let i = 0
    bench.add(`${label} miss 1/${N}`, () => {
      cells[i++ % N].miss()
    })
  }
  return bench
}

function benchThroughput() {
  const bench = new Bench({ time: 500, warmupTime: 100 })
  for (const [label, make] of CONTENDERS) {
    const c = make()
    bench.add(`${label} single-event`, () => c.hit())
  }
  return bench
}

async function run(title: string, b: Bench) {
  await b.warmup()
  await b.run()
  report(title, b)
}

export async function runFanout() {
  console.log('\n========== FAN-OUT / fine-grain / throughput ==========')
  for (const N of [100, 1000, 5000])
    await run(`A. Propagation — change 1 of ${N}`, benchPropagation(N))
  for (const N of [1000, 5000])
    await run(`B. Fine-grain — change an UNOBSERVED field, ${N} cells`, benchFineGrain(N))
  await run('C. Throughput — single machine, one event', benchThroughput())
  console.log('(anti-DCE SINK:', SINK.n, ')')
}
