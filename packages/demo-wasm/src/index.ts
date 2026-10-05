/**
 * The Rust demo machines (crates/demo) behind the TS `Machine` interface.
 *
 * Load the wasm once — `await loadDemo()` in a browser, `loadDemoSync(bytes)` (or
 * `./node`) in Node — then build machines with the factories below.
 */
import type { Machine } from '@dunky.dev/state-machine'
import { fromWasm, type WasmMachineHandle } from '@dunky.dev/state-machine-wasm'
import type {
  Command,
  CommandPaletteComputed,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteState,
} from '@sandbox/cmdk-core'
import init, {
  CellMachine,
  DialogMachine,
  GuardsMachine,
  HighlightMachine,
  initSync,
  ListMachine,
  noop,
  PaletteMachine,
  PingPongMachine,
  sink,
} from '../pkg/dunky_demo_wasm.js'

export { noop, sink }

/** Load the wasm in a browser (fetches `dunky_demo_wasm_bg.wasm` next to the glue). */
export async function loadDemo(input?: Parameters<typeof init>[0]): Promise<void> {
  await init(input)
}

/** Load the wasm synchronously from its bytes (Node, tests, workers). */
export function loadDemoSync(bytes: BufferSource): void {
  initSync({ module: bytes })
}

export type PaletteMachineTS = Machine<
  CommandPaletteState,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteComputed
>

/** The command palette. `results` crosses the boundary as indices and maps back onto
 * the caller's own command objects (Rust owns ids, rich values stay in JS). */
export function createPalette(commands: Command[]): PaletteMachineTS {
  const handle = new PaletteMachine(commands) as unknown as WasmMachineHandle
  return fromWasm<
    CommandPaletteState,
    CommandPaletteContext,
    CommandPaletteEvent,
    CommandPaletteComputed
  >(handle, {
    computed: {
      results: {
        from: 'resultIndices',
        map: raw => Array.from(raw as ArrayLike<number>, i => commands[i]!),
      },
    },
  })
}

/** The same palette, but `results` crosses the boundary as full objects (for comparison). */
export function createPaletteObjects(commands: Command[]): PaletteMachineTS {
  return fromWasm(new PaletteMachine(commands) as unknown as WasmMachineHandle)
}

export type CellContext = { value: number; other: number }
export function createCell(): Machine<'idle', CellContext, { type: 'hit' | 'miss' }> {
  return fromWasm(new CellMachine() as unknown as WasmMachineHandle)
}

export function createPingPong(): Machine<'ping' | 'pong', object, { type: 'go' }> {
  return fromWasm(new PingPongMachine() as unknown as WasmMachineHandle)
}

export function createGuards(k: number): Machine<'idle', { pick: number }, { type: 'go' }> {
  return fromWasm(new GuardsMachine(k) as unknown as WasmMachineHandle)
}

export type DialogState = 'closed' | 'open' | 'closing'
export type DialogContext = { exitMs: number; openCount: number }
export type DialogEvent = { type: 'open' | 'close' | 'toggle' }
export function createDialog(exitMs: number): Machine<DialogState, DialogContext, DialogEvent> {
  return fromWasm(new DialogMachine(exitMs) as unknown as WasmMachineHandle)
}

/** The rendering bench's shared list: one highlighted index. */
export function createList(): Machine<
  'idle',
  { highlighted: number },
  { type: 'move'; to: number }
> {
  return fromWasm(new ListMachine() as unknown as WasmMachineHandle)
}

/** The rendering bench's per-row machine: one boolean. */
export function createHighlight(
  on: boolean,
): Machine<'idle', { on: boolean }, { type: 'set'; on: boolean }> {
  return fromWasm(new HighlightMachine(on) as unknown as WasmMachineHandle)
}

/** Raw handles, for measuring the boundary without the adapter. */
export const raw = { PaletteMachine, CellMachine, PingPongMachine, GuardsMachine, DialogMachine }
