import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { commandPaletteMachineConfig, type CommandPaletteSource } from '@sandbox/cmdk-core'
import { App, type Engine } from './app'

// `--engine=rust` runs the same palette on the Rust machine (crates/demo → wasm; Bun
// runs WebAssembly). Build the wasm first: `pnpm build:wasm`.
const engine: Engine = process.argv.includes('--engine=rust') ? 'rust' : 'ts'

let source: CommandPaletteSource = commandPaletteMachineConfig
if (engine === 'rust') {
  // Imported only for the Rust engine, so the TS app runs without the wasm build.
  const demo = await import('@dunky.dev/demo-wasm/node')
  demo.loadDemoNode()
  source = props => demo.createPalette(props.commands)
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App engine={engine} source={source} />)
