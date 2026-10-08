<script lang="ts">
  import { DEMO_COMMANDS, type Command } from '@sandbox/cmdk-core'
  import CommandPalette from './command-palette.svelte'

  let last = $state('—')

  function onSelect(command: Command) {
    last = command.label
    window.alert(`Selected: ${command.label}`)
  }
</script>

<main class="demo">
  <h1 class="demo-title">⌘K Command Palette</h1>
  <br />
  <CommandPalette commands={DEMO_COMMANDS} {onSelect} />
  <br />
  <p class="demo-lead">
    One state machine drives this ⌘K palette.
    <br />
    The same machine + connect runs the Svelte, terminal (OpenTUI) and React Native versions
  </p>
  <p class="demo-hint">
    <strong>Last selected: {last}</strong>
  </p>
</main>
