/**
 * The engine: Rust (crates/core-wasm) compiled to wasm, built by `pnpm build:wasm`. The
 * bytes are inlined, so it starts synchronously — no `await init()` — on first use.
 */
import { engineHeapBytes, initSync, JsConfig, JsMachine } from '../wasm/dunky_core_wasm.js'
import { WASM } from '../wasm/bytes.js'

let started = false

/** Instantiate the engine once. Lazy, so importing the package costs nothing. */
export function startEngine(): void {
  if (started) return
  const binary = atob(WASM)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  initSync({ module: bytes })
  started = true
}

// `engineHeapBytes`: the engine's live heap, for the benchmark (not public API).
export { engineHeapBytes, JsConfig, JsMachine }
