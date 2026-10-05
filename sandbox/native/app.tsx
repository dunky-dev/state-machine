import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { commandPaletteMachineConfig, DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'
import { rustSource } from './rust-source'

type Engine = 'ts' | 'rust'

export default function App() {
  const [last, setLast] = useState('—')
  const [engine, setEngine] = useState<Engine>('ts')
  const rust = engine === 'rust' ? rustSource : null

  return (
    <View style={styles.main}>
      <StatusBar style='dark' />
      <Text style={styles.title}>⌘K Command Pallete</Text>
      <CommandPalette
        // useMachine builds its machine once per mount: a new key swaps the engine.
        key={engine}
        source={rust ?? commandPaletteMachineConfig}
        commands={DEMO_COMMANDS}
        onSelect={c => {
          setLast(c.label)
          Alert.alert('Selected', c.label)
        }}
      />
      <Text style={styles.lead}>
        One state machine drives this ⌘K palette.{'\n'}
        The same machine + connect runs the terminal (OpenTUI) and React Native versions
      </Text>
      <Text style={styles.hint}>Last selected: {last}</Text>
      <Pressable
        accessibilityRole='button'
        disabled={rustSource === null}
        onPress={() => setEngine(rust ? 'ts' : 'rust')}
      >
        <Text style={styles.engine}>
          Engine: {rust ? 'Rust (JSI)' : 'TypeScript'} ·{' '}
          {rustSource === null
            ? 'Rust is not built into this app'
            : `Switch to ${rust ? 'TypeScript' : 'Rust'}`}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  main: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, color: '#1c1e26' },
  lead: { maxWidth: 460, textAlign: 'center', color: '#5b6172', lineHeight: 24 },
  hint: { fontSize: 16, fontWeight: '700', color: '#8990a0' },
  engine: { fontSize: 14, textAlign: 'center', color: '#3142c4' },
})
