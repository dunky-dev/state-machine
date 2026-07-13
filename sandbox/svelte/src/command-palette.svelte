<script lang="ts">
  import { type ComponentEffect, normalize, useMachine } from '@dunky.dev/state-machine-svelte'
  import {
    commandPaletteMachineConfig,
    connectCommandPalette,
    type CommandPaletteMachine,
    type CommandPaletteProps,
  } from '@sandbox/cmdk-core'

  let props: CommandPaletteProps = $props()

  // Global ⌘K / Ctrl+K to open — a PLATFORM listener (a document key event), so it
  // lives here as a component effect, not in the machine. The machine just receives
  // `open`. This is the per-target "behavior meets platform" seam — identical to the
  // React sandbox's effect, only run through Svelte's useMachine instead of React's.
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

  // The DOM renderer. It owns ZERO interaction logic — useMachine runs the shared
  // machine, connect produces logical bindings, and normalize turns them into DOM
  // props (onPress→onclick, role/aria-*, etc). The component is just markup.
  const view = useMachine(
    commandPaletteMachineConfig,
    connectCommandPalette,
    [cmdkShortcut],
    () => props,
  )

  let input = $state<HTMLInputElement | null>(null)

  // Focus the input whenever the palette opens (a renderer concern, not the
  // machine's — focus is a platform touchpoint).
  $effect(() => {
    if (view.api.open) input?.focus()
  })
</script>

<div>
  <button type="button" class="trigger" onclick={() => view.api.setOpen(true)}>
    Search… <kbd>⌘K</kbd>
  </button>

  {#if view.api.open}
    <div
      class="backdrop"
      role="presentation"
      onclick={() => view.api.setOpen(false)}
      onkeydown={() => {}}
    >
      <!-- stopPropagation so clicks inside the panel don't close it -->
      <div
        class="panel"
        role="presentation"
        onclick={(e) => e.stopPropagation()}
        onkeydown={() => {}}
      >
        <input
          bind:this={input}
          {...normalize(view.api.parts.input)}
          value={view.api.query}
          placeholder="Type a command…"
          class="input"
        />
        <ul {...normalize(view.api.parts.root)} class="list">
          {#if view.api.results.length === 0}
            <li class="empty">No results</li>
          {/if}
          {#each view.api.results as command, index (command.id)}
            <li
              {...normalize(view.api.parts.getItemProps(command, index))}
              class="item"
              class:active={command.id === view.api.activeId}
            >
              <span>{command.label}</span>
              {#if command.hint}<kbd>{command.hint}</kbd>{/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</div>

<style>
  .trigger {
    display: flex;
    justify-content: space-between;
    min-width: 300px;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    font-size: 14px;
    color: #5b6172;
    background: #fff;
    border: 1px solid rgba(13, 15, 22, 0.12);
    border-radius: 10px;
    cursor: pointer;
  }
  kbd {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: #8990a0;
    background: rgba(13, 15, 22, 0.05);
    border: 1px solid rgba(13, 15, 22, 0.08);
    border-radius: 6px;
    padding: 2px 6px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(13, 15, 22, 0.35);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 14vh;
  }
  .panel {
    width: min(560px, 92vw);
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 24px 64px rgba(13, 15, 22, 0.28);
    overflow: hidden;
  }
  .input {
    width: 100%;
    min-width: 300px;
    box-sizing: border-box;
    padding: 18px 20px;
    font-size: 16px;
    border: none;
    border-bottom: 1px solid rgba(13, 15, 22, 0.08);
    outline: none;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 8px;
    max-height: 320px;
    overflow-y: auto;
  }
  .item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 14px;
    color: #1c1e26;
    cursor: pointer;
  }
  .item.active {
    background: rgba(91, 115, 255, 0.12);
    color: #3142c4;
  }
  .empty {
    padding: 16px 12px;
    color: #8990a0;
    font-size: 14px;
  }
</style>
