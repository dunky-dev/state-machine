/**
 * Construction cost. DISPOSABLE first-look benchmark.
 *
 * Times spin-up across engines: builds N machines/actors and measures
 * wall-clock for construction alone (no events sent). Both started, to match a
 * real mount.
 *
 *   core   : machine(config) + .start()
 *   xstate : createActor(createMachine(config)) + .start()
 *   zag    : new VanillaMachine(config) + .start()  (Zag's headless runtime)
 *
 * Construction is synchronous for all three (only Zag's `send` is async), so this
 * is a fair, comparable timing for every engine.
 *
 * Exported as `runConstruct()`; the suite runs it via benchmark/index.ts
 * (`pnpm benchmark`).
 */
import { createActor, createMachine as createXMachine, assign } from 'xstate'
import { createMachine as createZagMachine } from '@zag-js/core'
import { VanillaMachine } from '@zag-js/vanilla'
import { machine } from '@dunky.dev/state-machine'

type Ctx = { value: number; other: number }
type Ev = { type: 'hit' | 'miss' }

// Configs are shared across instances for ALL engines (module-level, like a
// real app's component config) — so the loop times MACHINE construction, not
// config-literal allocation. The old version rebuilt the core/xstate config per
// machine while zag shared its def, despite the comment below claiming parity.
const coreConfig = {
  initial: 'idle' as const,
  context: { value: 0, other: 0 },
  states: {
    idle: {
      on: {
        hit: {
          actions: [
            ({ context, setContext }: { context: Ctx; setContext: (p: Partial<Ctx>) => void }) =>
              setContext({ value: context.value + 1 }),
          ],
        },
        miss: {
          actions: [
            ({ context, setContext }: { context: Ctx; setContext: (p: Partial<Ctx>) => void }) =>
              setContext({ other: context.other + 1 }),
          ],
        },
      },
    },
  },
}
function buildCore() {
  const m = machine<'idle', Ctx, Ev>(coreConfig)
  m.start()
  return m
}

const xstateDef = createXMachine({
  context: { value: 0, other: 0 },
  on: {
    hit: { actions: assign({ value: ({ context }) => context.value + 1 }) },
    miss: { actions: assign({ other: ({ context }) => context.other + 1 }) },
  },
})
function buildXstate() {
  const a = createActor(xstateDef)
  a.start()
  return a
}

// Zag config is shared across all instances (built once), matching how the others
// reuse a single config — so we time machine construction, not config building.
// `hit`/`miss` transitions mirror core/xstate so all three build an EQUAL config
// surface (same event handlers + actions) — otherwise zag would construct a
// simpler machine and look artificially cheap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zagDef: any = createZagMachine({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context({ bindable }: any) {
    return {
      value: bindable(() => ({ defaultValue: 0 })),
      other: bindable(() => ({ defaultValue: 0 })),
    }
  },
  initialState() {
    return 'idle'
  },
  states: {
    idle: {
      on: {
        hit: { actions: ['inc'] },
        miss: { actions: ['incOther'] },
      },
    },
  },
  implementations: {
    actions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inc: ({ context }: any) => context.set('value', context.get('value') + 1),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      incOther: ({ context }: any) => context.set('other', context.get('other') + 1),
    },
  },
})
function buildZag() {
  const m = new VanillaMachine(zagDef, {})
  m.start?.()
  return m
}

const SINK: unknown[] = []

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// One timed pass: build N machines, return ms. Warms the JIT first.
function once(N: number, build: () => unknown): number {
  for (let i = 0; i < 1000; i++) SINK.push(build())
  SINK.length = 0
  const t0 = performance.now()
  for (let i = 0; i < N; i++) SINK.push(build())
  const ms = performance.now() - t0
  SINK.length = 0 // drop refs before next pass
  return ms
}

// Median of REPS passes — kills run-to-run / GC noise so the table is stable.
const REPS = 5
function time(_label: string, N: number, build: () => unknown): number {
  return median(Array.from({ length: REPS }, () => once(N, build)))
}

export async function runConstruct() {
  console.log('\n========== CONSTRUCTION COST ==========')
  for (const N of [1000, 10000]) {
    const core = time('core', N, buildCore)
    const xstate = time('xstate', N, buildXstate)
    const zag = time('zag', N, buildZag)
    console.log(`\n### Construct ${N.toLocaleString()} machines (built + started)`)
    console.table(
      [
        ['core', core],
        ['xstate', xstate],
        ['zag', zag],
      ].map(([engine, ms]) => ({
        engine,
        'total (ms)': (ms as number).toFixed(1),
        'µs / machine': (((ms as number) / N) * 1000).toFixed(2),
      })),
    )
  }
  console.log('(anti-DCE SINK len:', SINK.length, ')')
}
