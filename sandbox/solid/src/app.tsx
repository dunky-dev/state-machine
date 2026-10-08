import { createSignal } from 'solid-js'
import { DEMO_COMMANDS, type CommandPaletteSource } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

/** The language the palette machine is written in. Both run on the Rust engine. */
export type Language = 'ts' | 'rust'

export function App(props: { language: Language; source: CommandPaletteSource }) {
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
        Machine written in {props.language === 'rust' ? 'Rust' : 'TypeScript'} ·{' '}
        <a href={props.language === 'rust' ? '?' : '?machine=rust'}>
          Switch to {props.language === 'rust' ? 'TypeScript' : 'Rust'}
        </a>
      </p>
    </main>
  )
}
