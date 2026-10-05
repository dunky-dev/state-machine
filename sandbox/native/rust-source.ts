import { createNativePalette, loadNativeRust } from '@dunky.dev/native-rust'
import type { CommandPaletteSource } from '@sandbox/cmdk-core'

// The palette on the Rust engine (crates/demo over JSI), or null where this app has no
// Rust module: Expo Go, or a checkout that hasn't run `pnpm ubrn:ios` / `ubrn:android`.
// The TS palette must keep working there.
function rustPalette(): CommandPaletteSource | null {
  try {
    loadNativeRust()
  } catch (error) {
    console.warn(error)
    return null
  }
  return props => createNativePalette(props.commands)
}

export const rustSource = rustPalette()
