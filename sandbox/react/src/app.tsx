import { useState } from 'react'
import { DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export function App() {
  const [last, setLast] = useState('—')

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>⌘K Command Pallete</h1>
      <br />
      <CommandPalette
        commands={DEMO_COMMANDS}
        onSelect={c => {
          setLast(c.label)
          window.alert(`Selected: ${c.label}`)
        }}
      />
      <br />
      <p style={styles.lead}>
        One state machine drives this ⌘K palette.
        <br />
        The same machine + connect runs the terminal (OpenTUI) and React Native versions
      </p>
      <p style={styles.hint}>
        <strong>Last selected: {last}</strong>
      </p>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#1c1e26',
    background: 'linear-gradient(180deg, #eef1f6 0%, #ffffff 60%)',
  },
  title: { margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' },
  lead: { margin: 0, maxWidth: 460, textAlign: 'center', color: '#5b6172', lineHeight: 1.6 },
  hint: { margin: 0, color: '#8990a0', fontSize: 16 },
  kbd: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 11,
    background: 'rgba(13,15,22,0.05)',
    border: '1px solid rgba(13,15,22,0.08)',
    borderRadius: 6,
    padding: '2px 6px',
  },
}
