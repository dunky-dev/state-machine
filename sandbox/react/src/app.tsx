import { useState } from 'react'
import { DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export function App() {
  const [last, setLast] = useState('—')

  return (
    <main className='demo'>
      <h1 className='demo-title'>⌘K Command Palette</h1>
      <br />
      <CommandPalette
        commands={DEMO_COMMANDS}
        onSelect={c => {
          setLast(c.label)
          window.alert(`Selected: ${c.label}`)
        }}
      />
      <br />
      <p className='demo-lead'>
        One state machine drives this ⌘K palette.
        <br />
        The same machine + connect runs the React, terminal (OpenTUI), and React Native versions
      </p>
      <p className='demo-hint'>
        <strong>Last selected: {last}</strong>
      </p>
    </main>
  )
}
