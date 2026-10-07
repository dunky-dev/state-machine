import { readFileSync } from 'node:fs'
import { loadRustSync } from './rust'

/** Load the sandbox wasm in Node or Bun from the built package. */
export function loadRustNode(): void {
  loadRustSync(readFileSync(new URL('../rust/pkg/dunky_sandbox_bg.wasm', import.meta.url)))
}

export * from './rust'
