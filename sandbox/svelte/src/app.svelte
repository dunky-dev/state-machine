<script lang="ts">
  import { DEMO_COMMANDS, type Command } from '@sandbox/cmdk-core'
  import CommandPalette from './command-palette.svelte'

  let last = $state('—')

  function onSelect(c: Command) {
    last = c.label
    window.alert(`Selected: ${c.label}`)
  }
</script>

<main>
  <h1>⌘K Command Pallete</h1>
  <br />
  <CommandPalette commands={DEMO_COMMANDS} {onSelect} />
  <br />
  <p class="lead">
    One state machine drives this ⌘K palette.
    <br />
    The same machine + connect runs the React, terminal (OpenTUI) and React Native versions.
  </p>
  <p class="hint"><strong>Last selected: {last}</strong></p>
</main>

<style>
  main {
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
  h1 {
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
