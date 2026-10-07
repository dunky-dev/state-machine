import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { commandPaletteMachineConfig, type CommandPaletteSource } from '@sandbox/cmdk-core'
import { App, type Language } from './app'

// `--machine=rust` runs the palette written in Rust (sandbox/shared/rust → wasm) instead
// of the one written in TS. Build the wasm first: `pnpm build:wasm`.
const language: Language = process.argv.includes('--machine=rust') ? 'rust' : 'ts'

let source: CommandPaletteSource = commandPaletteMachineConfig
if (language === 'rust') {
  // Imported only for the Rust machine, so the TS app loads no second wasm module.
  const rust = await import('@sandbox/cmdk-core/rust-node')
  rust.loadRustNode()
  source = props => rust.createRustPalette(props.commands)
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App language={language} source={source} />)
