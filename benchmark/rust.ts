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
  return fromWasm<
    CommandPaletteState,
    CommandPaletteContext,
    CommandPaletteEvent,
    CommandPaletteComputed
  >(new PaletteMachine(commands), {
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

export type CellContext = { value: number; other: number }
export function createCell(): Machine<'idle', CellContext, { type: 'hit' | 'miss' }> {
  return fromWasm(new CellMachine())
}

export function createPingPong(): Machine<'ping' | 'pong', object, { type: 'go' }> {
  return fromWasm(new PingPongMachine())
}

export function createGuards(k: number): Machine<'idle', { pick: number }, { type: 'go' }> {
  return fromWasm(new GuardsMachine(k))
}

/** The rendering bench's shared list: one highlighted index. */
export function createList(): Machine<
  'idle',
  { highlighted: number },
  { type: 'move'; to: number }
> {
  return fromWasm(new ListMachine())
}

/** The rendering bench's per-row machine: one boolean. */
export function createHighlight(
  on: boolean,
): Machine<'idle', { on: boolean }, { type: 'set'; on: boolean }> {
  return fromWasm(new HighlightMachine(on))
}

/** Raw handles, for measuring the boundary without the facade. */
export const raw = { CellMachine, PingPongMachine }
