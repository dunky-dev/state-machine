import { useState } from 'react'
import { DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export function App() {
  const [last, setLast] = useState('—')

  return (
    <box style={{ flexDirection: 'column', alignItems: 'center', padding: 1, gap: 1 }}>
      <text fg='#1c1e26' attributes={1}>
        ⌘K Command Pallete
      </text>

      <CommandPalette commands={DEMO_COMMANDS} onSelect={c => setLast(c.label)} />

      <box style={{ flexDirection: 'column', alignItems: 'center' }}>
        <text fg='#5b6172'>One state machine drives this ⌘K palette.</text>
        <text fg='#5b6172'>
          The same machine + connect runs the terminal (OpenTUI) and React Native versions
        </text>
      </box>

      {/* A terminal has no modal alert — the equivalent is an unmissable banner. */}
      {last !== '—' ? (
        <box style={{ backgroundColor: '#1f9d55', paddingLeft: 1, paddingRight: 1 }}>
          <text fg='#ffffff' attributes={1}>
            ✔ Selected: {last}
          </text>
        </box>
      ) : (
        <text fg='#8990a0' attributes={1}>
          Last selected: —
        </text>
      )}
    </box>
  )
}
