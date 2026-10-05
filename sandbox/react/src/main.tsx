import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { commandPaletteMachineConfig, type CommandPaletteSource } from '@sandbox/cmdk-core'
import { App, type Engine } from './app'

// The stylesheet both web sandboxes share.
import '../../shared/src/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

// `?engine=rust` runs the same palette on the Rust machine (crates/demo → wasm).
// Build the wasm first: `pnpm build:wasm`.
const engine: Engine = new URLSearchParams(location.search).get('engine') === 'rust' ? 'rust' : 'ts'

async function boot(target: HTMLElement) {
  let source: CommandPaletteSource = commandPaletteMachineConfig
  if (engine === 'rust') {
    // Imported only for the Rust engine, so the TS page runs without the wasm build.
    const demo = await import('@dunky.dev/demo-wasm')
    await demo.loadDemo()
    source = props => demo.createPalette(props.commands)
  }
  createRoot(target).render(
    <StrictMode>
      <App engine={engine} source={source} />
    </StrictMode>,
  )
}

void boot(root)
