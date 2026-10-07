/**
 * The sandbox machines written in Rust (sandbox/shared/rust), wrapped with `fromWasm`.
 * Build the wasm first: `pnpm build:wasm`. Load it once — `await loadRust()` in a
 * browser, `loadRustSync(bytes)` (or `./rust-node`) in Node and Bun — then build
 * machines with the factories below.
 */
import { fromWasm, type Machine } from '@dunky.dev/state-machine'
import init, { DialogMachine, initSync, PaletteMachine } from '../rust/pkg/dunky_sandbox.js'
import type { CommandPaletteMachine } from './machine'
import type {
  Command,
  CommandPaletteComputed,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteState,
} from './types'

/** Load the wasm in a browser (fetches `dunky_sandbox_bg.wasm` next to the glue). */
export async function loadRust(input?: Parameters<typeof init>[0]): Promise<void> {
  await init(input)
}

/** Load the wasm synchronously from its bytes (Node, Bun, tests, workers). */
export function loadRustSync(bytes: BufferSource): void {
  initSync({ module: bytes })
}

/** The command palette. `results` crosses the boundary as indices and maps back onto
 * the caller's own command objects: Rust owns the ids, rich values stay in JS. */
export function createRustPalette(commands: Command[]): CommandPaletteMachine {
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

export type DialogState = 'closed' | 'open' | 'closing'
export type DialogContext = { exitMs: number; openCount: number }
export type DialogEvent = { type: 'open' | 'close' | 'toggle' }

/** A dialog whose `closing` phase lasts `exitMs` (an `after` timer on the host clock). */
export function createRustDialog(exitMs: number): Machine<DialogState, DialogContext, DialogEvent> {
  return fromWasm(new DialogMachine(exitMs))
}
