import { createSignal } from 'solid-js'
import type { JSX } from 'solid-js'
import { DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export function App() {
  const [last, setLast] = createSignal('—')

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
        The same machine + connect runs the DOM (React), terminal (OpenTUI) and React Native
        versions
      </p>
      <p style={styles.hint}>
        <strong>Last selected: {last()}</strong>
      </p>
    </main>
  )
}

const styles: Record<string, JSX.CSSProperties> = {
  main: {
    'min-height': '100vh',
    margin: 0,
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'center',
    gap: '16px',
    padding: '24px',
    'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#1c1e26',
    background: 'linear-gradient(180deg, #eef1f6 0%, #ffffff 60%)',
  },
  title: { margin: 0, 'font-size': '28px', 'font-weight': 700, 'letter-spacing': '-0.02em' },
  lead: {
    margin: 0,
    'max-width': '460px',
    'text-align': 'center',
    color: '#5b6172',
    'line-height': 1.6,
  },
  hint: { margin: 0, color: '#8990a0', 'font-size': '16px' },
}
