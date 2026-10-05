import { existsSync } from 'node:fs'

/**
 * Whether the demo machines were built to wasm (`pnpm build:wasm`). The wasm rows are
 * skipped when they were not, so the TS benchmarks run without a Rust toolchain.
 */
export function wasmBuilt(): boolean {
  return existsSync(new URL('../packages/demo-wasm/pkg/dunky_demo_wasm_bg.wasm', import.meta.url))
}

export const WASM_SKIPPED =
  '⚠️  wasm not built — skipping the Rust/wasm rows (run `pnpm build:wasm`).'
