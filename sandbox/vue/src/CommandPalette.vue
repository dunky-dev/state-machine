<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { type ComponentEffect, normalize, useMachine } from '@dunky.dev/state-machine-vue'
import {
  type Command,
  type CommandPaletteMachine,
  type CommandPaletteProps,
  commandPaletteMachineConfig,
  connectCommandPalette,
} from '@sandbox/cmdk-core'

const props = defineProps<CommandPaletteProps>()

// Global ⌘K / Ctrl+K to open — a PLATFORM listener (a document key event), so it
// lives here as a component effect, not in the machine. The machine just receives
// `open`. This is the per-target "behavior meets platform" seam.
const cmdkShortcut: ComponentEffect<CommandPaletteMachine, CommandPaletteProps> = [
  machine => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        machine.send({ type: 'open' })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  },
  [],
]

// useMachine runs the shared machine, `connect` produces logical bindings, and
// `normalize` turns them into DOM props (onPress→onClick, role/aria-*, etc). The
// component is just markup — it owns ZERO interaction logic.
const { api } = useMachine(commandPaletteMachineConfig, connectCommandPalette, [cmdkShortcut], props)

const inputRef = ref<HTMLInputElement | null>(null)

// Focus the input whenever the palette opens (a renderer concern, not the
// machine's — focus is a platform touchpoint).
watch(
  () => api.value.open,
  open => {
    if (open) nextTick(() => inputRef.value?.focus())
  },
)

function itemStyle(command: Command) {
  return command.id === api.value.activeId ? { ...styles.item, ...styles.itemActive } : styles.item
}

const styles = {
  trigger: {
    display: 'flex',
    justifyContent: 'space-between',
    minWidth: '300px',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    fontSize: '14px',
    color: '#5b6172',
    background: '#fff',
    border: '1px solid rgba(13,15,22,0.12)',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  kbd: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '11px',
    color: '#8990a0',
    background: 'rgba(13,15,22,0.05)',
    border: '1px solid rgba(13,15,22,0.08)',
    borderRadius: '6px',
    padding: '2px 6px',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(13,15,22,0.35)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '14vh',
  },
  panel: {
    width: 'min(560px, 92vw)',
    background: '#fff',
    borderRadius: '14px',
    boxShadow: '0 24px 64px rgba(13,15,22,0.28)',
    overflow: 'hidden',
  },
  input: {
    width: '100%',
    minWidth: '300px',
    boxSizing: 'border-box',
    padding: '18px 20px',
    fontSize: '16px',
    border: 'none',
    borderBottom: '1px solid rgba(13,15,22,0.08)',
    outline: 'none',
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
  },
  list: { listStyle: 'none', margin: 0, padding: '8px', maxHeight: '320px', overflowY: 'auto' },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#1c1e26',
    cursor: 'pointer',
  },
  itemActive: { background: 'rgba(91,115,255,0.12)', color: '#3142c4' },
  empty: { padding: '16px 12px', color: '#8990a0', fontSize: '14px' },
} as const
</script>

<template>
  <div>
    <button type="button" :style="styles.trigger" @click="api.setOpen(true)">
      Search… <kbd :style="styles.kbd">⌘K</kbd>
    </button>

    <div v-if="api.open" :style="styles.backdrop" @click="api.setOpen(false)">
      <div :style="styles.panel" @click.stop>
        <input
          ref="inputRef"
          v-bind="normalize(api.parts.input)"
          :value="api.query"
          placeholder="Type a command…"
          :style="styles.input"
        />
        <ul v-bind="normalize(api.parts.root)" :style="styles.list">
          <li v-if="api.results.length === 0" :style="styles.empty">No results</li>
          <li
            v-for="(command, index) in api.results"
            :key="command.id"
            v-bind="normalize(api.parts.getItemProps(command, index))"
            :style="itemStyle(command)"
          >
            <span>{{ command.label }}</span>
            <kbd v-if="command.hint" :style="styles.kbd">{{ command.hint }}</kbd>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
