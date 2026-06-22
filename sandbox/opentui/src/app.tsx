import { useState } from 'react'
import { DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export function App() {
  const [last, setLast] = useState('—')

  return (
    <box style={{ flexDirection: 'column', alignItems: 'center', padding: 1, gap: 1 }}>
      {/* No hardcoded fg colors anywhere — text inherits the terminal's default
          foreground, so the demo reads correctly in both light and dark themes.
          Emphasis comes from bold (attributes={1}), and the one accent uses a
          NAMED ANSI color ('green'), which the terminal maps to its own palette. */}
      <text attributes={1}>⌘K Command Pallete</text>

      <CommandPalette commands={DEMO_COMMANDS} onSelect={c => setLast(c.label)} />

      <box style={{ flexDirection: 'column', alignItems: 'center' }}>
        <text>One state machine drives this ⌘K palette.</text>
        <text>
          The same machine + connect runs the terminal (OpenTUI) and React Native versions
        </text>
      </box>

      {/* A terminal has no modal alert — the equivalent is an unmissable line.
          'green' is a named ANSI color, so it follows the terminal theme. */}
      {last !== '—' ? (
        <text fg='green' attributes={1}>
          ✔ Selected: {last}
        </text>
      ) : (
        <text attributes={1}>Last selected: —</text>
      )}
    </box>
  )
}
