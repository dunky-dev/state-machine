/**
 * React rendering — first render (mount) + re-render counting. DISPOSABLE.
 *
 * The ops/sec benchmarks measure engine work; this measures the thing that
 * actually hurts in a real app — how many React components render. Two numbers:
 *   - MOUNT      : rows rendered on first paint (the cost to put N rows on screen)
 *   - RE-RENDERS : rows that re-render when one machine in the list changes
 *                  (the fine-grained payoff made concrete).
 *
 * Setup: a list of N items, each backed by its own machine. Two strategies:
 *
 *   A. coarse (whole snapshot) — each item renders off the connector's snapshot
 *      via useSyncExternalStore (what useMachine does per instance). Change one
 *      item → only that item's store wakes (each has its own machine), so this
 *      is already decent — we measure it as the baseline.
 *   B. selector (useSelector) — a SHARED machine whose context holds an array /
 *      a highlighted index; N children each useSelector on "am I highlighted?".
 *      Move the highlight: with fine-grained selection only the 2 affected rows
 *      re-render; a naive whole-snapshot subscription re-renders all N.
 *
 * We count renders by incrementing a per-row counter in the component body.
 *
 * Run with jsdom registered:
 *   pnpm tsx --conditions=browser benchmark/rerenders/run.ts
 * (run.ts sets up jsdom then imports this)
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createMachine as createZagMachine } from '@zag-js/core'
import { useMachine as useZagMachine } from '@zag-js/react'
import {
  createMachine as createXMachine,
  createActor as createXActor,
  assign,
  type Actor,
} from 'xstate'
import { useSelector as useXSelector } from '@xstate/react'
import { machine, type Machine } from '@chimba-ui/state-machine'
import { useSelector } from '@chimba-ui/react-state-machine'

type Ctx = { highlighted: number }
type Ev = { type: 'move'; to: number }

// ONE shared machine holding the highlighted index (the core/selector arena).
function makeListMachine(): Machine<'idle', Ctx, Ev> {
  return machine<'idle', Ctx, Ev>({
    initial: 'idle',
    context: { highlighted: 0 },
    states: {
      idle: {
        on: {
          move: { actions: [({ event, setContext }) => setContext({ highlighted: event.to })] },
        },
      },
    },
  })
}

// One core machine PER ROW, holding its own `on` bool (the per-instance arena —
// the apples-to-apples comparison vs Zag, which is always one machine per row).
function makeCoreHighlightMachine(
  initial: boolean,
): Machine<'idle', { on: boolean }, { type: 'set'; on: boolean }> {
  return machine<'idle', { on: boolean }, { type: 'set'; on: boolean }>({
    initial: 'idle',
    context: { on: initial },
    states: {
      idle: { on: { set: { actions: [({ event, setContext }) => setContext({ on: event.on })] } } },
    },
  })
}

// Zag machine: one per row via useMachine (Zag's native shape — a machine per
// component instance). `active` comes in as a PROP; Zag mirrors it into context
// via a controlled bindable. The list re-renders the parent on a move, but each
// row only does real work when ITS `active` flips — Zag at its best.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zagHighlightMachine: any = createZagMachine({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props({ props }: any) {
    return { active: false, ...props }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context({ prop, bindable }: any) {
    return {
      on: bindable<boolean>(() => ({ value: prop('active'), defaultValue: false })),
    }
  },
  initialState() {
    return 'idle'
  },
  states: { idle: {} },
})

// XState fine-grained arena: ONE shared actor holding the highlighted index, and
// each row uses @xstate/react's `useSelector(actor, s => s.context.highlighted
// === index)`. This is XState's real answer to "only the changed rows re-render"
// — directly parallel to core's `selector` arena — and avoids the
// effect→send→re-render double-pass a per-instance useMachine+prop would incur.
const xstateListMachine = createXMachine({
  context: { highlighted: 0 },
  on: {
    move: { actions: assign({ highlighted: ({ event }) => (event as { to: number }).to }) },
  },
})

const renderCounts = {
  selector: 0,
  naive: 0,
  'core/instance': 0,
  'zag/instance': 0,
  'xstate/selector': 0,
}

// Fine-grained row: re-renders only when ITS highlighted-ness flips.
function SelectorRow({ m, index }: { m: Machine<'idle', Ctx, Ev>; index: number }) {
  const isHL = useSelector(m, () => m.context.highlighted === index)
  renderCounts.selector++
  return <div data-hl={isHL ? '1' : '0'}>{index}</div>
}

// Naive row: subscribes to the WHOLE context (reads highlighted directly each
// render and re-renders on any change) — the O(all) React shape.
function NaiveRow({ m, index }: { m: Machine<'idle', Ctx, Ev>; index: number }) {
  // read the whole highlighted value (not "=== index"), so every move re-renders every row
  const hl = useSelector(m, () => m.context.highlighted)
  renderCounts.naive++
  return <div data-hl={hl === index ? '1' : '0'}>{index}</div>
}

// Per-instance core row: each owns its machine; re-renders only when its own bool flips.
function CoreInstanceRow({ m }: { m: ReturnType<typeof makeCoreHighlightMachine> }) {
  const on = useSelector(m, () => m.context.on)
  renderCounts['core/instance']++
  return <div data-hl={on ? '1' : '0'} />
}

// Per-instance Zag row: each owns a Zag machine via useMachine, fed `active` as a
// prop. React.memo so a parent re-render only actually re-renders the rows whose
// `active` PROP changed (the 2) — the idiomatic React+Zag pattern. Without memo,
// a parent list re-render would re-run every row, measuring the harness not Zag.
const ZagInstanceRow = React.memo(function ZagInstanceRow({ active }: { active: boolean }) {
  const service = useZagMachine(zagHighlightMachine, { active })
  renderCounts['zag/instance']++
  return <div data-hl={service.context.get('on') ? '1' : '0'} />
})

// XState fine-grained row: a SHARED actor + useSelector("am I highlighted?").
// XState's real "wake only the changed rows" path — parallel to core's selector.
type XActor = Actor<typeof xstateListMachine>
function XStateSelectorRow({ actor, index }: { actor: XActor; index: number }) {
  const isHL = useXSelector(actor, s => s.context.highlighted === index)
  renderCounts['xstate/selector']++
  return <div data-hl={isHL ? '1' : '0'}>{index}</div>
}

type Strategy = 'selector' | 'naive' | 'core/instance' | 'zag/instance' | 'xstate/selector'
type Row = { mount: number; mountMs: number; renders: number; ms: number }

export async function runRenderingBench(N: number, moves: number) {
  // Use flushSync (prod-safe) rather than React's `act`, which is stripped under
  // NODE_ENV=production (the suite runs in prod). flushSync runs the callback and
  // synchronously commits any resulting render, so render counts are deterministic.
  const results: Partial<Record<Strategy, Row>> = {}

  // Two arenas:
  //  - SHARED (selector, naive): ONE machine holds the highlighted index; a move
  //    is one `move` event. selector wakes only the 2 rows whose highlight flips;
  //    naive re-renders all N.
  //  - PER-INSTANCE (core/instance, zag/instance): N machines, one per row, each
  //    holding its own bool. A move flips exactly 2 (old off, new on) → only
  //    those 2 rows re-render. This is Zag's native shape (one machine per
  //    component), so it's the apples-to-apples arena vs core's per-instance.
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

  // One mount + `moves` re-renders, timed. Render COUNTS are deterministic; the
  // ms are jsdom-noisy, so `run` repeats this and reports the MEDIAN ms (below).
  const onePass = (
    strategy: Strategy,
    mountTree: () => React.ReactNode,
    move: (k: number) => void,
  ) => {
    renderCounts[strategy] = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const mt0 = performance.now()
    flushSync(() => root.render(<>{mountTree()}</>))
    const mountMs = performance.now() - mt0
    const mount = renderCounts[strategy]

    const t0 = performance.now()
    for (let k = 0; k < moves; k++) flushSync(() => move(k))
    const ms = performance.now() - t0

    flushSync(() => root.unmount())
    container.remove()
    return { mount, mountMs, renders: renderCounts[strategy] - mount, ms }
  }

  // Median of REPS passes — jsdom render ms swing run-to-run (GC, layout), so a
  // single pass is unreliable; the median is the stable, reproducible figure.
  const REPS = 5
  const run = (
    strategy: Strategy,
    mountTree: () => React.ReactNode,
    move: (k: number) => void,
  ): Row => {
    const passes = Array.from({ length: REPS }, () => onePass(strategy, mountTree, move))
    return {
      mount: passes[0].mount, // deterministic across passes
      renders: passes[0].renders, // deterministic
      mountMs: median(passes.map(p => p.mountMs)),
      ms: median(passes.map(p => p.ms)),
    }
  }

  // --- SHARED arena: selector + naive (one machine) ---
  for (const strategy of ['selector', 'naive'] as const) {
    const m = makeListMachine()
    m.start()
    const RowC = strategy === 'selector' ? SelectorRow : NaiveRow
    results[strategy] = run(
      strategy,
      () => Array.from({ length: N }, (_, i) => <RowC key={i} m={m} index={i} />),
      k => m.send({ type: 'move', to: k % N }),
    )
    m.stop()
  }

  // --- PER-INSTANCE arena: core (N machines) ---
  {
    const ms_ = Array.from({ length: N }, (_, i) => makeCoreHighlightMachine(i === 0))
    ms_.forEach(m => m.start())
    let cur = 0
    results['core/instance'] = run(
      'core/instance',
      () => ms_.map((m, i) => <CoreInstanceRow key={i} m={m} />),
      k => {
        const next = k % N
        ms_[cur].send({ type: 'set', on: false })
        ms_[next].send({ type: 'set', on: true })
        cur = next
      },
    )
    ms_.forEach(m => m.stop())
  }

  // --- PER-INSTANCE arena: zag (N machines, useMachine owns each) ---
  // Zag holds state per useMachine instance; to flip from outside we re-render
  // with a different `highlighted` index and let each row's machine react. Since
  // each row's machine is internal to useMachine, we drive via a parent index.
  {
    let cur = 0
    const Parent = ({ hi }: { hi: number }) => (
      <>
        {Array.from({ length: N }, (_, i) => (
          <ZagInstanceRow key={i} active={i === hi} />
        ))}
      </>
    )
    let setHi: (n: number) => void = () => {}
    const Host = () => {
      const [hi, set] = React.useState(0)
      setHi = set
      return <Parent hi={hi} />
    }
    results['zag/instance'] = run(
      'zag/instance',
      () => <Host />,
      k => {
        cur = k % N
        setHi(cur)
      },
    )
  }

  // --- FINE-GRAINED arena: xstate selector (one actor + useSelector per row) ---
  // XState's fine-grained path, the counterpart to core's `selector`: ONE actor
  // holds the highlighted index; each row useSelectors "am I highlighted?", so a
  // `move` wakes only the 2 rows whose answer flipped. This is its OWN top-level
  // arena (built/mounted/torn down once via run()'s REPS) — directly parallel to
  // the `selector` arena above.
  {
    const actor = createXActor(xstateListMachine)
    actor.start()
    results['xstate/selector'] = run(
      'xstate/selector',
      () =>
        Array.from({ length: N }, (_, i) => <XStateSelectorRow key={i} actor={actor} index={i} />),
      k => actor.send({ type: 'move', to: k % N }),
    )
    actor.stop()
  }

  console.log(`\n### Rendering — list of ${N}: first render (mount) + ${moves} highlight moves`)
  // NOTE on the `mount (ms)` column: it is NOT apples-to-apples across rows — it
  // reflects each library's idiomatic per-row primitive, which is the only fair
  // way to compare them. core/instance + xstate/selector rows mount a
  // `useSelector`/`useSyncExternalStore` subscription; zag/instance mounts a
  // full `useMachine` + `React.memo` wrapper per row (required so a parent move
  // re-renders only the 2 rows whose `active` prop flips — without memo the
  // harness, not Zag, would dominate). selector/naive share ONE machine. So read
  // `mount (ms)` as "cost of THIS library's idiomatic row", not a like-for-like
  // primitive. The re-render COUNTS (avg rows/move) ARE directly comparable.
  console.table(
    Object.entries(results).map(([k, v]) => ({
      strategy: k,
      'mount renders': v!.mount,
      'mount (ms)': v!.mountMs.toFixed(1),
      're-renders (total)': v!.renders,
      'avg rows / move': (v!.renders / moves).toFixed(1),
      // Zag's `send` is async (microtask-batched), so it can't be flushed under
      // the synchronous flushSync re-render loop — the ms isn't comparable to the
      // sync engines (it balloons). Report n/a; its row-count (2) IS fair + shown.
      're-render wall (ms)': k === 'zag/instance' ? 'n/a (async)' : v!.ms.toFixed(1),
    })),
  )
}
