/**
 * The sandbox machines written in Rust (crates/sandbox), wrapped with `fromWasm`.
 * Build the wasm first: `pnpm build:wasm`. Load it once — `await loadRust()` in a
 * browser, `loadRustSync(bytes)` (or `./rust-node`) in Node and Bun — then build
 * machines with the factories below. Their types come from the Rust types: the build
 * generates them onto each class, and `fromWasm` reads them.
 */
import { fromWasm, type TypesOf } from '@dunky.dev/state-machine-wasm'
import init, {
  DialogMachine,
  initSync,
  PaletteMachine,
} from '../../../crates/sandbox/pkg/dunky_sandbox.js'
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
  return fromWasm(new PaletteMachine(commands), {
    computed: {
      results: {
        from: 'resultIndices',
        map: raw => Array.from(raw as ArrayLike<number>, i => commands[i]!),
      },
    },
  })
}

/** A dialog whose `closing` phase lasts `exitMs` (an `after` timer on the host clock). */
export function createRustDialog(exitMs: number) {
  return fromWasm(new DialogMachine(exitMs))
}

export type DialogState = TypesOf<DialogMachine>['state']
export type DialogContext = TypesOf<DialogMachine>['context']
export type DialogEvent = TypesOf<DialogMachine>['event']

// The Rust palette's generated types must be the TS palette's, exactly: `pnpm typecheck`
// fails here as soon as one side changes without the other.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type RustPalette = TypesOf<PaletteMachine>
export type RustPaletteMatchesTs = [
  Expect<Same<RustPalette['state'], CommandPaletteState>>,
  Expect<Same<RustPalette['context'], CommandPaletteContext>>,
  Expect<Same<RustPalette['event'], CommandPaletteEvent>>,
  Expect<Same<RustPalette['computed'], CommandPaletteComputed>>,
]
