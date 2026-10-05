/**
 * The Rust command palette (crates/demo, over JSI) behind the TypeScript `Machine`
 * interface.
 *
 * ubrn generates `PaletteMachine` into ./generated: the wasm handle protocol, with
 * values as JSON strings. `NativePaletteHandle` turns it back into a
 * `WasmMachineHandle`, so `fromWasm` drives it unchanged.
 */
import {
  fromWasm,
  type WasmMachineHandle,
  type WasmMachineMeta,
} from '@dunky.dev/state-machine-wasm'
import type {
  Command,
  CommandPaletteComputed,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteState,
} from '@sandbox/cmdk-core'
import type { PaletteMachine } from './generated'

type Bindings = typeof import('./generated')

let bindings: Bindings | undefined

/**
 * Loads the Rust module into the JS runtime, once. Throws, with the reason, when this
 * app does not carry it (Expo Go, or no `pnpm ubrn:ios` / `pnpm ubrn:android` yet).
 */
export function loadNativeRust(): Bindings {
  if (!bindings) {
    // A require in try/catch, not an import: Metro then bundles a checkout where
    // ./generated does not exist yet, and the error surfaces here instead.
    try {
      bindings = require('./generated') as Bindings
    } catch (cause) {
      throw new Error(
        '[native-rust] cannot load the Rust module: build it (packages/native-rust: pnpm ubrn:ios / ubrn:android), then rebuild the app',
        { cause },
      )
    }
  }
  return bindings
}

/** The generated `PaletteMachine` as a `WasmMachineHandle`. A class on purpose:
 * `fromWasm` caches the meta per handle prototype. */
export class NativePaletteHandle implements WasmMachineHandle {
  private readonly machine: PaletteMachine

  constructor(commands: readonly Command[]) {
    this.machine = new (loadNativeRust().PaletteMachine)(JSON.stringify(commands))
  }

  sendKind(kind: number): number {
    return this.machine.sendKind(kind)
  }

  sendPayload(kind: number, event: unknown): number {
    return this.machine.sendPayloadJson(kind, JSON.stringify(event))
  }

  sendEvent(event: unknown): number {
    const { type } = event as { type: string }
    const kind = this.meta().events.indexOf(type)
    if (kind < 0) throw new Error(`[machine] no event type "${type}"`)
    return this.sendPayload(kind, event)
  }

  stateIndex(): number {
    return this.machine.stateIndex()
  }

  field(index: number): unknown {
    return JSON.parse(this.machine.fieldJson(index))
  }

  fields(): unknown[] {
    return JSON.parse(this.machine.fieldsJson()) as unknown[]
  }

  computed(index: number): unknown {
    return JSON.parse(this.machine.computedJson(index))
  }

  computedVersion(index: number): number {
    return this.machine.computedVersion(index)
  }

  start(): number {
    return this.machine.start()
  }

  stop(): number {
    return this.machine.stop()
  }

  fireTimer(id: number): number {
    return this.machine.fireTimer(id)
  }

  takeCommands(): Uint32Array {
    return Uint32Array.from(this.machine.takeCommands())
  }

  meta(): WasmMachineMeta {
    return JSON.parse(this.machine.metaJson()) as WasmMachineMeta
  }
}

/** The command palette on the Rust engine. As in `createPalette` (@dunky.dev/demo-wasm),
 * `results` crosses as indices and maps back onto the caller's own command objects. */
export function createNativePalette(commands: Command[]) {
  return fromWasm<
    CommandPaletteState,
    CommandPaletteContext,
    CommandPaletteEvent,
    CommandPaletteComputed
  >(new NativePaletteHandle(commands), {
    computed: {
      results: {
        from: 'resultIndices',
        map: raw => (raw as number[]).map(i => commands[i]!),
      },
    },
  })
}
