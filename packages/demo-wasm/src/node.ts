import { readFileSync } from 'node:fs'
import { loadDemoSync } from './index'

/** Load the demo wasm in Node from the built package. */
export function loadDemoNode(): void {
  loadDemoSync(readFileSync(new URL('../pkg/dunky_demo_wasm_bg.wasm', import.meta.url)))
}

export * from './index'
