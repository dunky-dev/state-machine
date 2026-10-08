<script setup lang="ts">
import { ref } from 'vue'
import { type Command, DEMO_COMMANDS } from '@sandbox/cmdk-core'
import CommandPalette from './command-palette.vue'

const last = ref('—')

function onSelect(command: Command) {
  last.value = command.label
  window.alert(`Selected: ${command.label}`)
}
</script>

<template>
  <main class="demo">
    <h1 class="demo-title">⌘K Command Palette</h1>
    <br />
    <CommandPalette :commands="DEMO_COMMANDS" @select="onSelect" />
    <br />
    <p class="demo-lead">
      One state machine drives this ⌘K palette.
      <br />
      The same machine + connect runs the Vue, terminal (OpenTUI) and React Native versions
    </p>
    <p class="demo-hint">
      <strong>Last selected: {{ last }}</strong>
    </p>
  </main>
</template>
