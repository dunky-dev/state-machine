import { existsSync } from 'node:fs'

/**
 * Whether the benchmark machines were built to wasm (`pnpm build:wasm`). The Rust rows
 * are skipped when they were not.
 */
export function wasmBuilt(): boolean {
  return existsSync(new URL('./rust/pkg/dunky_benchmark_bg.wasm', import.meta.url))
}

export const WASM_SKIPPED =
  '⚠️  wasm not built — skipping the Rust-machine rows (run `pnpm build:wasm`).'
