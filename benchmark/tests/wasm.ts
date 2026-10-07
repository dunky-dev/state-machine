/**
 * A machine written in TS vs the same machine written in Rust — both on the Rust engine.
 *
 * Every Rust row runs the SAME machine as its TS row (benchmark/rust ports them 1:1):
 *
 *   ts machine   — `machine(config)`: the engine (wasm) calls back into the TS user code.
 *   rust machine — through `fromWasm`: the `Machine` interface over a Rust machine in its
 *                  own wasm module. This is what a React/Solid target actually calls.
 *   rust raw     — the bare wasm-bindgen handle, no facade: the boundary floor.
 *
 * Needs the wasm build (`pnpm build:wasm`). Set SPIKE_OUT=<file.json> to also write the
 * numbers as JSON (the spike report reads them).
 *
 * Exported as `runWasm()`; the suite runs it via benchmark/index.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { Bench } from 'tinybench'
import { machine } from '@dunky.dev/state-machine'
import { commandPaletteMachineConfig, type Command } from '@sandbox/cmdk-core'
import {
  createCell,
  createGuards,
  createPalette,
  createPaletteObjects,
  createPingPong,
  loadRust,
  noop,
  raw,
  WASM_URL,
} from '../rust'
import { report } from '../report'

const SINK = { n: 0 }
const bump = () => {
  SINK.n++
}

interface Row {
  name: string
  hz: number
  meanUs: number
  rme: number
}
interface Section {
  id: string
  title: string
  rows: Row[]
}
const sections: Section[] = []

async function run(id: string, title: string, bench: Bench): Promise<void> {
  await bench.warmup()
  await bench.run()
  report(title, bench)
  sections.push({
    id,
    title,
    rows: bench.tasks.map(t => ({
      name: t.name,
      hz: t.result?.hz ?? 0,
      meanUs: (t.result?.mean ?? 0) * 1000,
      rme: t.result?.rme ?? 0,
    })),
  })
}

const newBench = () => new Bench({ time: 500, warmupTime: 100 })

// --- TS twins of the Rust machines (benchmark/rust) --------------------------
type CellCtx = { value: number; other: number }
const cellConfig = {
  initial: 'idle' as const,
  context: { value: 0, other: 0 },
  states: {
    idle: {
      on: {
        hit: {
          actions: [
            ({
              context,
              setContext,
            }: {
              context: CellCtx
              setContext: (p: Partial<CellCtx>) => void
            }) => setContext({ value: context.value + 1 }),
          ],
        },
        miss: {
          actions: [
            ({
              context,
              setContext,
            }: {
              context: CellCtx
              setContext: (p: Partial<CellCtx>) => void
            }) => setContext({ other: context.other + 1 }),
          ],
        },
      },
    },
  },
}
const tsCell = () => machine<'idle', CellCtx, { type: 'hit' | 'miss' }>(cellConfig)

const pingPongConfig = {
  initial: 'ping' as const,
  context: {},
  states: {
    ping: { entry: [bump], exit: [bump], on: { go: { target: 'pong' as const } } },
    pong: { entry: [bump], exit: [bump], on: { go: { target: 'ping' as const } } },
  },
}
const tsPingPong = () => machine<'ping' | 'pong', object, { type: 'go' }>(pingPongConfig)

function tsGuards(k: number) {
  const candidates = Array.from({ length: k }, (_, i) => ({
    guard: ({ context }: { context: { pick: number } }) => context.pick === i,
    actions: [bump],
  }))
  return machine<'idle', { pick: number }, { type: 'go' }>({
    initial: 'idle',
    context: { pick: k - 1 },
    states: { idle: { on: { go: candidates } } },
  })
}

// Synthetic command sets with realistic labels for the subsequence filter.
const VERBS = ['Go to', 'Open', 'Create', 'Toggle', 'Invite', 'Archive', 'Rename', 'Share']
const NOUNS = ['Dashboard', 'Issue', 'Pull Request', 'Settings', 'Project', 'Teammate', 'Board']
function makeCommands(n: number): Command[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cmd-${i}`,
    label: `${VERBS[i % VERBS.length]} ${NOUNS[(i * 7) % NOUNS.length]} ${i}`,
    group: NOUNS[i % NOUNS.length],
  }))
}
const QUERIES = ['go', 'gpr', 'set', 'pro 1', 'to b', '']

// --- A. boundary floor ---------------------------------------------------------
function benchBoundary() {
  const b = newBench()
  const jsNoop = (x: number) => x
  let x = 0
  b.add('js: function call', () => {
    x = jsNoop(x + 1) & 0xffff
  })
  b.add('wasm: noop(u32) call', () => {
    x = noop(x + 1) & 0xffff
  })
  return b
}

// --- B. one event, observed field (the single-event throughput shape) ----------
function benchCell(field: 'hit' | 'miss') {
  const b = newBench()
  const ts = tsCell()
  ts.start()
  ts.select.context('value').subscribe(bump)
  const rs = createCell()
  rs.start()
  rs.select.context('value').subscribe(bump)
  const handle = new raw.CellMachine()
  handle.start()
  const kind = field === 'hit' ? 0 : 1
  const event = { type: field } as const
  b.add('ts machine', () => ts.send(event))
  b.add('rust machine', () => rs.send(event))
  b.add('rust raw', () => handle.send(kind, event))
  return b
}

// --- C. state churn: exit + entry actions every event --------------------------
function benchPingPong() {
  const b = newBench()
  const ts = tsPingPong()
  ts.start()
  const rs = createPingPong()
  rs.start()
  const handle = new raw.PingPongMachine()
  handle.start()
  const go = { type: 'go' } as const
  b.add('ts machine', () => ts.send(go))
  b.add('rust machine', () => rs.send(go))
  b.add('rust raw', () => handle.send(0, go))
  return b
}

// --- D. guard fallthrough, 8 candidates, the last wins --------------------------
function benchGuards(k: number) {
  const b = newBench()
  const ts = tsGuards(k)
  ts.start()
  const rs = createGuards(k)
  rs.start()
  const go = { type: 'go' } as const
  b.add('ts machine', () => ts.send(go))
  b.add('rust machine', () => rs.send(go))
  return b
}

// --- E. palette: type a query, read results + activeId (computed) ---------------
function benchPalette(n: number) {
  const b = newBench()
  const commands = makeCommands(n)
  const ts = machine(commandPaletteMachineConfig({ commands }))
  ts.start()
  ts.send({ type: 'open' })
  const rsIdx = createPalette(commands)
  rsIdx.start()
  rsIdx.send({ type: 'open' })
  const rsObj = createPaletteObjects(commands)
  rsObj.start()
  rsObj.send({ type: 'open' })
  let i = 0
  const typeAndRead = (m: typeof ts | typeof rsIdx) => {
    m.send({ type: 'query.set', query: QUERIES[i++ % QUERIES.length]! })
    SINK.n += m.computed.results.length + (m.computed.activeId?.length ?? 0)
  }
  b.add('ts machine', () => typeAndRead(ts))
  b.add('rust machine (indices → own objects)', () => typeAndRead(rsIdx))
  b.add('rust machine (objects cross)', () => typeAndRead(rsObj))
  return b
}

// --- F. construction: build + start one machine ---------------------------------
function benchConstruct() {
  const b = newBench()
  b.add('ts machine: machine(config) + start', () => {
    const m = tsCell()
    m.start()
    SINK.n += m.context.value
  })
  b.add('rust machine: createCell() + start', () => {
    const m = createCell()
    m.start()
    SINK.n += m.context.value
  })
  b.add('rust raw: new CellMachine() + start', () => {
    const h = new raw.CellMachine()
    SINK.n += h.start() === 0 ? 1 : 0
  })
  return b
}

function measureInit(): { compileMs: number; firstInitMs: number } {
  const bytes = readFileSync(WASM_URL)
  const runs = 20
  const t0 = performance.now()
  for (let i = 0; i < runs; i++) new WebAssembly.Module(bytes)
  const compileMs = (performance.now() - t0) / runs
  const t1 = performance.now()
  loadRust()
  const firstInitMs = performance.now() - t1
  return { compileMs, firstInitMs }
}

export async function runWasm() {
  console.log('\n========== TS machines vs Rust machines (both on the Rust engine) ==========')
  const init = measureInit()
  console.log(
    `wasm init: compile ${init.compileMs.toFixed(2)} ms (avg of 20) · first initSync ${init.firstInitMs.toFixed(2)} ms`,
  )
  await run('boundary', 'A. boundary floor', benchBoundary())
  await run('cell-hit', 'B. one event, observed field (hit)', benchCell('hit'))
  await run('cell-miss', 'B2. one event, unobserved field (miss)', benchCell('miss'))
  await run('pingpong', 'C. state churn (exit + entry actions)', benchPingPong())
  await run('guards-8', 'D. guard fallthrough (8 candidates)', benchGuards(8))
  for (const n of [11, 1_000, 10_000]) {
    await run(
      `palette-${n}`,
      `E. palette: type + read computed (${n.toLocaleString()} commands)`,
      benchPalette(n),
    )
  }
  await run('construct', 'F. construct + start one machine', benchConstruct())
  console.log('(anti-DCE SINK:', SINK.n, ')')

  const out = process.env.SPIKE_OUT
  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        { node: process.version, date: new Date().toISOString(), init, sections },
        null,
        2,
      ),
    )
    console.log(`spike results written to ${out}`)
  }
}
