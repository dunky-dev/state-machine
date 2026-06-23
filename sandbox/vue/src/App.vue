<script setup lang="ts">
import { ref } from 'vue'
import { type Command, DEMO_COMMANDS } from '@sandbox/cmdk-core'
import CommandPalette from './CommandPalette.vue'

const last = ref('—')

function onSelect(command: Command) {
  last.value = command.label
  window.alert(`Selected: ${command.label}`)
}
</script>

<template>
  <main class="main">
    <h1 class="title">⌘K Command Pallete</h1>
    <br />
    <CommandPalette :commands="DEMO_COMMANDS" :on-select="onSelect" />
    <br />
    <p class="lead">
      One state machine drives this ⌘K palette.
      <br />
      The same machine + connect runs the terminal (OpenTUI) and React versions
    </p>
    <p class="hint">
      <strong>Last selected: {{ last }}</strong>
    </p>
  </main>
</template>

<style scoped>
.main {
  min-height: 100vh;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1c1e26;
  background: linear-gradient(180deg, #eef1f6 0%, #ffffff 60%);
}
.title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.lead {
  margin: 0;
  max-width: 460px;
  text-align: center;
  color: #5b6172;
  line-height: 1.6;
}
.hint {
  margin: 0;
  color: #8990a0;
  font-size: 16px;
}
</style>
