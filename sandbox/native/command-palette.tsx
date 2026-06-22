import { useEffect, useRef } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
// Same split as the OpenTUI app: lifecycle hook from the React binding (RN uses a
// React renderer), prop translator from the native package.
import { useMachine } from '@dunky.dev/state-machine-react'
import { mergeProps, normalize } from '@dunky.dev/state-machine-native'
import {
  commandPaletteMachineConfig,
  type CommandPaletteProps,
  connectCommandPalette,
} from '@sandbox/cmdk-core'

// The React NATIVE renderer. Identical wiring — same shared machine + connect —
// only `normalize` (native package → accessibility props / onPress) and the RN
// elements differ. There's no global keyboard on mobile, so the trigger is a tap
// and rows are tapped to execute; arrow-key nav simply isn't part of this
// substrate. The machine doesn't care — it just receives `highlight`/`execute`.
export function CommandPalette(props: CommandPaletteProps) {
  const { api, machine } = useMachine(commandPaletteMachineConfig, connectCommandPalette, [], props)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    if (api.open) inputRef.current?.focus()
  }, [api.open])

  const inputProps = normalize(api.parts.input)

  return (
    <View>
      <Pressable style={styles.trigger} onPress={() => api.setOpen(true)}>
        <Text style={styles.triggerText}>Search commands…</Text>
      </Pressable>

      <Modal
        visible={api.open}
        transparent
        animationType='fade'
        onRequestClose={() => api.setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => api.setOpen(false)}>
          <Pressable style={styles.panel} onPress={() => {}}>
            <TextInput
              ref={inputRef}
              {...(inputProps as object)}
              value={api.query}
              onChangeText={text => machine.send({ type: 'query.set', query: text })}
              placeholder='Type a command…'
              placeholderTextColor='#8990a0'
              style={styles.input}
              autoFocus
            />
            <ScrollView style={styles.list} keyboardShouldPersistTaps='handled'>
              {api.results.length === 0 && <Text style={styles.empty}>No results</Text>}
              {api.results.map((command, index) => {
                const selected = command.id === api.activeId
                const itemProps = normalize(api.parts.getItemProps(command, index))
                // Merge the machine's onPress with RN's Pressable contract.
                const merged = mergeProps(itemProps, {})
                return (
                  <Pressable
                    key={command.id}
                    {...(merged as object)}
                    style={[styles.item, selected && styles.itemActive]}
                  >
                    <Text style={[styles.itemText, selected && styles.itemTextActive]}>
                      {command.label}
                    </Text>
                    {command.hint && <Text style={styles.hint}>{command.hint}</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  trigger: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(13,15,22,0.12)',
  },
  triggerText: { fontSize: 15, color: '#5b6172' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,15,22,0.4)',
    justifyContent: 'flex-start',
    paddingTop: '20%',
    paddingHorizontal: 20,
  },
  panel: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  input: {
    padding: 16,
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(13,15,22,0.08)',
    color: '#1c1e26',
  },
  list: { maxHeight: 320 },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  itemActive: { backgroundColor: 'rgba(91,115,255,0.12)' },
  itemText: { fontSize: 15, color: '#1c1e26' },
  itemTextActive: { color: '#3142c4', fontWeight: '600' },
  hint: { fontSize: 12, color: '#8990a0' },
  empty: { padding: 16, color: '#8990a0', fontSize: 15 },
})
