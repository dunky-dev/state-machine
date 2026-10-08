import { createSignal } from 'solid-js'
import { DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export function App() {
  const [last, setLast] = createSignal('—')

  return (
    <main class='demo'>
      <h1 class='demo-title'>⌘K Command Palette</h1>
      <br />
      <CommandPalette
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
    </main>
  )
}
