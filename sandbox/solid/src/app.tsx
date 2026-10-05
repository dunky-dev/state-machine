import { createSignal } from 'solid-js'
import { DEMO_COMMANDS, type CommandPaletteSource } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export type Engine = 'ts' | 'rust'

export function App(props: { engine: Engine; source: CommandPaletteSource }) {
  const [last, setLast] = createSignal('—')

  return (
    <main class='demo'>
      <h1 class='demo-title'>⌘K Command Palette</h1>
      <br />
      <CommandPalette
        source={props.source}
        commands={DEMO_COMMANDS}
        onSelect={c => {
          setLast(c.label)
          window.alert(`Selected: ${c.label}`)
        }}
      />
      <br />
      <p class='demo-lead'>
        One state machine drives this ⌘K palette.
        <br />
        The same machine + connect runs the Solid, terminal (OpenTUI) and React Native versions
      </p>
      <p class='demo-hint'>
        <strong>Last selected: {last()}</strong>
      </p>
      <p class='demo-hint'>
        Engine: {props.engine === 'rust' ? 'Rust (wasm)' : 'TypeScript'} ·{' '}
        <a href={props.engine === 'rust' ? '?' : '?engine=rust'}>
          Switch to {props.engine === 'rust' ? 'TypeScript' : 'Rust'}
        </a>
      </p>
    </main>
  )
}
