<script lang="ts">
  import { type ComponentEffect, normalize, useMachine } from '@dunky.dev/svelte-state-machine'
  import {
    commandPaletteMachineConfig,
    type CommandPaletteMachine,
    type CommandPaletteProps,
    connectCommandPalette,
  } from '@sandbox/cmdk-core'

  let props: CommandPaletteProps = $props()

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
  // component is just markup; the look lives in the shared stylesheet.
  const view = useMachine(
    commandPaletteMachineConfig,
    connectCommandPalette,
    [cmdkShortcut],
    () => props,
  )

  let input: HTMLInputElement | undefined = $state()
  // `view.api` is replaced on every machine change; a derived slice changes
  // only on open/close, so the effect below doesn't re-focus on each keystroke.
  const open = $derived(view.api.open)

  // Focus on open — a platform touchpoint, so the renderer owns it.
  $effect(() => {
    if (open) input?.focus()
  })
</script>

<div>
  <button type="button" class="cmdk-trigger" onclick={() => view.api.setOpen(true)}>
    Search… <kbd class="cmdk-kbd">⌘K</kbd>
  </button>

  {#if view.api.open}
    <!-- Pointer-only conveniences, like the React and Solid apps: the keyboard
         path is Escape, which the machine handles from the input. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="cmdk-backdrop" onclick={() => view.api.setOpen(false)}>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="cmdk-panel" onclick={e => e.stopPropagation()}>
        <input
          bind:this={input}
          {...normalize(view.api.parts.input)}
          value={view.api.query}
          placeholder="Type a command…"
          class="cmdk-input"
        />
        <ul {...normalize(view.api.parts.root)} class="cmdk-list">
          {#if view.api.results.length === 0}
            <li class="cmdk-empty">No results</li>
          {/if}
          {#each view.api.results as command, index (command.id)}
            <li
              {...normalize(view.api.parts.getItemProps(command, index))}
              class={['cmdk-item', { 'is-active': command.id === view.api.activeId }]}
            >
              <span>{command.label}</span>
              {#if command.hint}
                <kbd class="cmdk-kbd">{command.hint}</kbd>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</div>
