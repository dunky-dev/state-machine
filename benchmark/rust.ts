/**
 * The benchmark machines written in Rust (benchmark/rust), wrapped with `fromWasm` — each
 * one the twin of a TS machine in this suite. Needs the wasm build (`pnpm build:wasm`);
 * `loadRust()` before building machines.
 */
import { readFileSync } from 'node:fs'
import { fromWasm, type Machine } from '@dunky.dev/state-machine'
import type {
  Command,
  CommandPaletteComputed,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteState,
} from '@sandbox/cmdk-core'
import {
  CellMachine,
  GuardsMachine,
  HighlightMachine,
  initSync,
  ListMachine,
  noop,
  PaletteMachine,
  PingPongMachine,
  sink,
} from './rust/pkg/dunky_benchmark.js'

export { noop, sink }

export const WASM_URL = new URL('./rust/pkg/dunky_benchmark_bg.wasm', import.meta.url)

let loaded = false
/** Load the wasm synchronously (idempotent). */
export function loadRust(): void {
  if (loaded) return
  initSync({ module: readFileSync(WASM_URL) })
  loaded = true
}

type Palette = Machine<
  CommandPaletteState,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteComputed
>

/** The command palette; `results` crosses as indices, mapped onto the caller's objects. */
export function createPalette(commands: Command[]): Palette {
  return fromWasm(new PaletteMachine(commands), {
    computed: {
      results: {
        from: 'resultIndices',
        map: raw => Array.from(raw as ArrayLike<number>, i => commands[i]!),
      },
    },
  })
}

/** The same palette, with `results` crossing as full objects (for comparison). */
export function createPaletteObjects(commands: Command[]): Palette {
  return fromWasm(new PaletteMachine(commands))
}

// Each machine's types come from its Rust types (generated onto the class by the build).
export function createCell() {
  return fromWasm(new CellMachine())
}

export function createPingPong() {
  return fromWasm(new PingPongMachine())
}

export function createGuards(k: number) {
  return fromWasm(new GuardsMachine(k))
}

/** The rendering bench's shared list: one highlighted index. */
export function createList() {
  return fromWasm(new ListMachine())
}

/** The rendering bench's per-row machine: one boolean. */
export function createHighlight(on: boolean) {
  return fromWasm(new HighlightMachine(on))
}

/** Raw handles, for measuring the boundary without the facade. */
export const raw = { CellMachine, PingPongMachine }
