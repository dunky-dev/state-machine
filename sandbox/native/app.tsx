import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { DEMO_COMMANDS } from '@sandbox/cmdk-core'
import { CommandPalette } from './command-palette'

export default function App() {
  const [last, setLast] = useState('—')

  return (
    <View style={styles.main}>
      <StatusBar style='dark' />
      <Text style={styles.title}>⌘K Command Pallete</Text>
      <CommandPalette
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
})
