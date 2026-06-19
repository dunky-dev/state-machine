/**
 * Memory per machine. DISPOSABLE first-look benchmark.
 *
 * The central claim — "flat memory at 5k scale, even with fat context" (the
 * trading-view case) — asserted in the README with no script until now. This
 * measures it: build N machines, hold them live, report retained heap / machine.
 *
 * Two context widths, because the whole point of the plain-object model is that
 * memory should stay ~flat in FIELD COUNT (no per-field reactive cell):
 *   - thin :  2 fields
 *   - fat  : 64 fields   (the case that would blow up a cell-per-field engine)
 *
 * Needs accurate GC (--expose-gc); the suite (`pnpm benchmark`) passes it.
 * Exported as `runMemory()`; run via benchmark/index.ts.
 *
 * heapMB() force-GCs before sampling (no-op without --expose-gc — it'll WARN).
 */
import { createActor, createMachine as createXMachine, assign } from 'xstate'
import { createMachine as createZagMachine } from '@zag-js/core'
import { VanillaMachine } from '@zag-js/vanilla'
import { machine } from '@dunky.dev/state-machine'
import { heapMB } from '../report'

const FIELDS = { thin: 2, fat: 64 } as const

function makeContext(n: number): Record<string, number> {
  const ctx: Record<string, number> = {}
  for (let i = 0; i < n; i++) ctx[`f${i}`] = 0
  return ctx
}

// ONE config per width, shared by all N machines — the shape a real app has
// (a component's config is a module-level const; instances share it). The old
// version built a fresh config + context per machine, so it measured config
// duplication, not per-machine overhead.
const coreConfigCache = new Map<number, ReturnType<typeof coreConfig>>()
function coreConfig(fields: number) {
  return {
    initial: 'idle' as const,
    context: makeContext(fields),
    states: {
      idle: {
        on: {
          hit: {
            actions: [
              ({
                context: c,
                setContext,
              }: {
                context: Record<string, number>
                setContext: (p: Record<string, number>) => void
              }) => setContext({ f0: c.f0 + 1 }),
            ],
          },
        },
      },
    },
  }
}
function buildCore(fields: number) {
  let cfg = coreConfigCache.get(fields)
  if (!cfg) coreConfigCache.set(fields, (cfg = coreConfig(fields)))
  const m = machine(cfg)
  m.start()
  return m
}

// xstate: same sharing — one machine DEF per width. With a static `context`
// object, actors share its reference until the first assign() allocates a
// per-actor context (XState's own lazy-copy shape), so the idle/written split
// is directly comparable to core's.
const xstateDefCache = new Map<number, ReturnType<typeof xstateDef>>()
function xstateDef(fields: number) {
  return createXMachine({
    context: makeContext(fields),
    on: { hit: { actions: assign({ f0: ({ context: c }) => c.f0 + 1 }) } },
  })
}
function buildXstate(fields: number) {
  let def = xstateDefCache.get(fields)
  if (!def) xstateDefCache.set(fields, (def = xstateDef(fields)))
  const a = createActor(def)
  a.start()
  return a
}

// Zag's headless runtime (VanillaMachine). Context is one `bindable` reactive
// cell PER FIELD — the model that grows memory with field count, which this bench
// exposes. A Zag config is shared across instances, like the others.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildZag(fields: number, cfg: any) {
  const m = new VanillaMachine(cfg, {})
  m.start?.()
  return m
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zagConfig(fields: number): any {
  return createZagMachine({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context({ bindable }: any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = {}
      for (let i = 0; i < fields; i++) ctx[`f${i}`] = bindable(() => ({ defaultValue: 0 }))
      return ctx
    },
    initialState() {
      return 'idle'
    },
    // `hit` mirrors core/xstate (which both bump f0) so all three machines carry
    // an equal config surface — otherwise zag's per-instance footprint would be
    // measured against a machine with no event handlers.
    states: {
      idle: {
        on: { hit: { actions: ['inc'] } },
      },
    },
    implementations: {
      actions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inc: ({ context }: any) => context.set('f0', context.get('f0') + 1),
      },
    },
  })
}

// A built machine that accepts a `hit` event — all three engines expose `.send`.
type Sendable = { send: (e: { type: string }) => void }

interface Engine {
  build: (fields: number) => unknown
  // Fire one `hit` so a write actually happens. Core owns its context copy from
  // construction (idle ≈ written by design); for XState the first assign()
  // allocates a per-actor context, so its written footprint grows — the
  // idle/written split exists to expose lazy-copy schemes like that.
  write: (m: unknown) => void
}

const sendHit = (m: unknown) => (m as Sendable).send({ type: 'hit' })

const ENGINES: Record<string, Engine> = {
  core: { build: buildCore, write: sendHit },
  xstate: { build: buildXstate, write: sendHit },
  // bind a shared per-width config so we measure machine overhead, not config dup
  zag: {
    build: (() => {
      const cache = new Map<number, unknown>()
      return (fields: number) => {
        if (!cache.has(fields)) cache.set(fields, zagConfig(fields))
        return buildZag(fields, cache.get(fields))
      }
    })(),
    write: sendHit,
  },
}

function measureOnce(engine: Engine, N: number, fields: number, write: boolean): number {
  const before = heapMB()
  const hold: unknown[] = Array.from({ length: N })
  for (let i = 0; i < N; i++) {
    const m = engine.build(fields)
    if (write) engine.write(m)
    hold[i] = m
  }
  const after = heapMB()
  // keep `hold` reachable across the sample so it isn't collected
  if ((hold as unknown[]).length !== N) throw new Error('unreachable')
  return after - before // MB retained by the N machines
}

// Median of a few passes — more honest than min-of-N, which biases toward the
// pass where background GC happened to reclaim the most and can under-report the
// true retained set. heapMB() already double-GCs before each sample.
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
function measure(engine: Engine, N: number, fields: number, write: boolean): number {
  // Warmup OUTSIDE the measured window: builds (and writes) a few hundred
  // machines so one-time costs — JIT, hidden classes, the shared config cache —
  // aren't retained-set-attributed to whichever engine/mode runs first.
  for (let i = 0; i < 200; i++) engine.write(engine.build(fields))
  return median(Array.from({ length: 3 }, () => measureOnce(engine, N, fields, write)))
}

export async function runMemory() {
  console.log('\n========== MEMORY PER MACHINE ==========')
  if (!global.gc) {
    console.warn('⚠️  no --expose-gc — numbers are noisy (the suite passes it for you).')
  }
  const N = 5000
  // Two modes: IDLE (never written) and WRITTEN (one hit each — the footprint a
  // real churny app pays). Core owns its context from construction, so its two
  // rows should match; the split exposes engines whose first write allocates
  // (XState's assign builds a per-actor context).
  for (const write of [false, true]) {
    const mode = write ? 'written (1 hit each)' : 'idle (never written)'
    for (const [width, fields] of Object.entries(FIELDS)) {
      console.log(
        `\n### Memory — ${N.toLocaleString()} machines, ${width} context (${fields} fields), ${mode}`,
      )
      const rows = Object.entries(ENGINES).map(([name, engine]) => {
        const mb = measure(engine, N, fields, write)
        return {
          engine: name,
          'total (MB)': mb.toFixed(1),
          'KB / machine': ((mb * 1024) / N).toFixed(2),
        }
      })
      console.table(rows)
    }
  }
}
