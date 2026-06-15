/**
 * Per-cell ENGINE instances — no React. Each engine models one cell as a tiny
 * state machine that, per update, does the work the benchmark measures:
 *   - a GUARDED transition (guard fallthrough),
 *   - a context write that feeds a COMPUTED / derived value,
 *   - reading that computed back out (the selection path).
 *
 * The demo times how many of these updates each engine can apply per frame
 * budget. The grid paints each cell's current computed value to a canvas on a
 * throttled tick, so DOM/paint cost is constant and tiny across panels — what
 * differs is the ENGINE cost, which is the whole point.
 *
 * `paintValue(i)` returns the cell's current computed output (0..1e6) for the
 * heatmap. `update(i, v)` applies one guarded transition with input `v`.
 */
import { machine, type Machine } from '@chimba-ui/state-machine'
import { createMachine as createXMachine, createActor as createXActor, assign } from 'xstate'
import { createMachine as createZagMachine } from '@zag-js/core'
import { VanillaMachine } from '@zag-js/vanilla'

export interface CellEngine {
  update: (index: number, v: number) => void
  paintValue: (index: number) => number
  dispose: () => void
  // Async engines (Zag) don't run a transition synchronously in `update` — they
  // defer it to a microtask. `flush` resolves once every `update` issued so far
  // has ACTUALLY executed, so the demo can measure real transition work under a
  // wall-clock budget instead of counting `update` calls that merely returned.
  // Absent ⇒ the engine is fully synchronous (work is done when `update` returns).
  flush?: () => Promise<void>
}

// The derived computation every engine performs, so the work is identical —
// only the engine machinery around it differs. Cheap but non-trivial.
function derive(v: number): number {
  return (v * 3 + 7) % 1_000_000
}
// which guard branch wins depends on v, so the guard list is actually walked
const BRANCHES = 4

// --- Chimba: one machine per cell, guarded transition + computed -------------

type CCtx = { raw: number; bucket: number }
type CEv = { type: 'set'; v: number }
type CComputed = { out: number }

export function makeChimbaEngine(size: number, seed: (i: number) => number): CellEngine {
  const cells: Machine<'idle', CCtx, CEv, CComputed>[] = Array.from({ length: size }, (_, i) => {
    const m = machine<'idle', CCtx, CEv, CComputed>({
      initial: 'idle',
      context: { raw: seed(i), bucket: 0 },
      computed: {
        out: ({ context }) => derive(context.raw),
      },
      states: {
        idle: {
          on: {
            // guarded candidates: the matching bucket wins (guard fallthrough)
            set: Array.from({ length: BRANCHES }, (_, b) => ({
              guard: ({ event }: { event: CEv }) => event.v % BRANCHES === b,
              actions: [({ event, setContext }) => setContext({ raw: event.v, bucket: b })],
            })),
          },
        },
      },
    })
    m.start()
    return m
  })
  return {
    update(i, v) {
      cells[i].send({ type: 'set', v })
    },
    paintValue(i) {
      return cells[i].computed.out // memoized; recomputes only when raw changed
    },
    dispose() {
      cells.forEach(m => m.stop())
    },
  }
}

// --- XState: one actor per cell, guarded transition + assign-derived field ----

type XCtx = { raw: number; bucket: number; out: number }
type XEv = { type: 'set'; v: number }

// one guarded candidate per bucket (guard fallthrough), built dynamically.
// XState can't infer XEv through Array.from, so this transition list is typed
// loosely and fed in via `on.set`; the runtime behavior (guard by bucket, assign
// raw/bucket/out from the event) is exactly the intent.
const xSetTransitions = Array.from({ length: BRANCHES }, (_, b) => ({
  guard: ({ event }: { event: XEv }) => event.v % BRANCHES === b,
  actions: assign(({ event }: { event: XEv }) => ({
    raw: event.v,
    bucket: b,
    out: derive(event.v),
  })),
}))

const xCell = createXMachine({
  types: {} as { context: XCtx; events: XEv; input: { raw: number } },
  context: ({ input }) => ({ raw: input.raw, bucket: 0, out: derive(input.raw) }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: { set: xSetTransitions as any },
})

export function makeXStateEngine(size: number, seed: (i: number) => number): CellEngine {
  const cells = Array.from({ length: size }, (_, i) => {
    const a = createXActor(xCell, { input: { raw: seed(i) } })
    a.start()
    return a
  })
  return {
    update(i, v) {
      cells[i].send({ type: 'set', v })
    },
    paintValue(i) {
      return cells[i].getSnapshot().context.out
    },
    dispose() {
      cells.forEach(a => a.stop())
    },
  }
}

// --- Zag: one VanillaMachine per cell, guarded transition + bindable cell -----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zagCell: any = createZagMachine({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context({ bindable }: any) {
    return {
      raw: bindable(() => ({ defaultValue: 0 })),
      out: bindable(() => ({ defaultValue: 0 })),
    }
  },
  initialState() {
    return 'idle'
  },
  states: {
    idle: {
      on: {
        // Zag guards are strings resolved from implementations; one guarded
        // entry per bucket mirrors the fallthrough.
        set: Array.from({ length: BRANCHES }, (_, b) => ({
          guard: `is${b}`,
          actions: ['apply'],
        })),
      },
    },
  },
  implementations: {
    guards: Object.fromEntries(
      Array.from({ length: BRANCHES }, (_, b) => [
        `is${b}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ event }: any) => event.v % BRANCHES === b,
      ]),
    ),
    actions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apply: ({ context, event }: any) => {
        context.set('raw', event.v)
        context.set('out', derive(event.v))
      },
    },
  },
})

export function makeZagEngine(size: number, seed: (i: number) => number): CellEngine {
  const cells = Array.from({ length: size }, (_, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m: any = new VanillaMachine(zagCell, { context: { raw: seed(i) } })
    m.start?.()
    return m
  })
  return {
    update(i, v) {
      cells[i].send({ type: 'set', v })
    },
    paintValue(i) {
      return cells[i].context.get('out')
    },
    // Zag's send() schedules the transition in a microtask (see machine.js:
    // `send = (e) => queueMicrotask(() => {...transition...})`). Every send issued
    // before this point enqueued its microtask first, so a single microtask turn
    // drains them ALL (FIFO, run-to-completion) — verified: 1000 sends ⇒ 1000
    // transitions after one `await`. No coalescing, no timer latency to taint the
    // wall-clock measurement.
    flush() {
      return Promise.resolve()
    },
    dispose() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cells.forEach((m: any) => m.stop?.())
    },
  }
}

// --- Raw: no engine — plain array + inline derive (the control) ---------------

export function makeRawEngine(size: number, seed: (i: number) => number): CellEngine {
  const out = new Int32Array(size)
  for (let i = 0; i < size; i++) out[i] = derive(seed(i))
  return {
    update(i, v) {
      // the same guard walk + derive, but as plain JS — no machine machinery
      let bucket = 0
      for (let b = 0; b < BRANCHES; b++) {
        if (v % BRANCHES === b) {
          bucket = b
          break
        }
      }
      void bucket
      out[i] = derive(v)
    },
    paintValue(i) {
      return out[i]
    },
    dispose() {},
  }
}
