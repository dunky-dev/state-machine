import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { commandPaletteMachineConfig, type CommandPaletteSource } from '@sandbox/cmdk-core'
import { App, type Language } from './app'

// The stylesheet both web sandboxes share.
import '../../shared/src/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

// `?machine=rust` runs the palette written in Rust (sandbox/shared/rust → wasm) instead
// of the one written in TS. Build the wasm first: `pnpm build:wasm`.
const language: Language =
  new URLSearchParams(location.search).get('machine') === 'rust' ? 'rust' : 'ts'

async function boot(target: HTMLElement) {
  let source: CommandPaletteSource = commandPaletteMachineConfig
  if (language === 'rust') {
    // Imported only for the Rust machine, so the TS page loads no second wasm module.
    const rust = await import('@sandbox/cmdk-core/rust')
    await rust.loadRust()
    source = props => rust.createRustPalette(props.commands)
  }
  createRoot(target).render(
    <StrictMode>
      <App language={language} source={source} />
    </StrictMode>,
  )
}

void boot(root)
