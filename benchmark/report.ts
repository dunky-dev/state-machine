/** Shared reporting helpers for the benchmark suite. */
import type { Bench } from 'tinybench'

export function report(title: string, bench: Bench): void {
  console.log(`\n### ${title}`)
  const rows = bench.tasks.map(t => ({
    name: t.name,
    'ops/sec': t.result ? Math.round(t.result.hz).toLocaleString() : 'n/a',
    'mean (µs)': t.result ? (t.result.mean * 1000).toFixed(3) : 'n/a',
    // Relative margin of error (%): how much run-to-run noise is in the mean.
    // A 5% gap between two rows is only real if it clears their ±rme — without
    // this column a reader can't tell signal from jitter.
    '±rme %': t.result ? t.result.rme.toFixed(1) : 'n/a',
    samples: t.result ? t.result.samples.length : 0,
  }))
  console.table(rows)
}

export function heapMB(): number {
  // Two GC passes: V8's first GC often leaves objects that only become
  // unreachable after finalizers/weak refs from the first sweep are processed, so
  // a single gc() can read high. A second pass reaches a stable heap — the
  // trustworthy retained-set figure. (No-op without --expose-gc.)
  if (global.gc) {
    global.gc()
    global.gc()
  }
  return process.memoryUsage().heapUsed / 1024 / 1024
}
