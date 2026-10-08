<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'
import { type ComponentEffect, normalize, useMachine } from '@dunky.dev/vue-state-machine'
import {
  commandPaletteMachineConfig,
  type CommandPaletteMachine,
  type CommandPaletteProps,
  connectCommandPalette,
} from '@sandbox/cmdk-core'

const props = defineProps<CommandPaletteProps>()

// Global ⌘K / Ctrl+K to open — a platform listener, so it lives here as a
// component effect, not in the machine. Same tuple shape as the React sandbox.
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

// The DOM renderer — zero interaction logic; `useMachine` runs the shared
// machine and `normalize` maps the logical bindings to DOM props. The
// component is just markup; the look lives in the stylesheet shared with the
// React and Solid apps.
const { api } = useMachine(
  commandPaletteMachineConfig,
  connectCommandPalette,
  [cmdkShortcut],
  props,
)

const input = useTemplateRef<HTMLInputElement>('input')

// Focus on open — `post`, so the input the open state rendered exists.
watch(
  () => api.value.open,
  open => {
    if (open) input.value?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <div>
    <button type="button" class="cmdk-trigger" @click="api.setOpen(true)">
      Search… <kbd class="cmdk-kbd">⌘K</kbd>
    </button>

    <div v-if="api.open" class="cmdk-backdrop" @click="api.setOpen(false)">
      <div class="cmdk-panel" @click.stop>
        <input
          ref="input"
          v-bind="normalize(api.parts.input)"
          :value="api.query"
          placeholder="Type a command…"
          class="cmdk-input"
        />
        <ul v-bind="normalize(api.parts.root)" class="cmdk-list">
          <li v-if="api.results.length === 0" class="cmdk-empty">No results</li>
          <li
            v-for="(command, index) in api.results"
            :key="command.id"
            v-bind="normalize(api.parts.getItemProps(command, index))"
            :class="['cmdk-item', { 'is-active': command.id === api.activeId }]"
          >
            <span>{{ command.label }}</span>
            <kbd v-if="command.hint" class="cmdk-kbd">{{ command.hint }}</kbd>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
