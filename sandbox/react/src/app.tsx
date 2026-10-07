import { useState } from 'react'
import { DEMO_COMMANDS, type CommandPaletteSource } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

/** The language the palette machine is written in. Both run on the Rust engine. */
export type Language = 'ts' | 'rust'

export function App({ language, source }: { language: Language; source: CommandPaletteSource }) {
  const [last, setLast] = useState('—')

  return (
    <main className='demo'>
      <h1 className='demo-title'>⌘K Command Palette</h1>
      <br />
      <CommandPalette
        source={source}
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
      <p className='demo-hint'>
        Machine written in {language === 'rust' ? 'Rust' : 'TypeScript'} ·{' '}
        <a href={language === 'rust' ? '?' : '?machine=rust'}>
          Switch to {language === 'rust' ? 'TypeScript' : 'Rust'}
        </a>
      </p>
    </main>
  )
}
