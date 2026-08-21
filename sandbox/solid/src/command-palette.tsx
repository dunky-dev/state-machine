import { createEffect, For, Show } from 'solid-js'
import { type ComponentEffect, normalize, useMachine } from '@dunky.dev/solid-state-machine'
import {
  commandPaletteMachineConfig,
  type CommandPaletteMachine,
  type CommandPaletteProps,
  connectCommandPalette,
} from '@sandbox/cmdk-core'

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
// React app.
export function CommandPalette(props: CommandPaletteProps) {
  const { api } = useMachine(
    commandPaletteMachineConfig,
    connectCommandPalette,
    [cmdkShortcut],
    props,
  )

  let inputEl: HTMLInputElement | undefined

  // Focus on open; drop the ref on close so a detached <input> isn't retained.
  // (The drop lives here because Solid 2.0 refs are unowned — no onCleanup
  // inside ref callbacks.)
  createEffect(
    () => api.open,
    open => {
      if (open) inputEl?.focus()
      else inputEl = undefined
    },
  )

  return (
    <div>
      <button type='button' class='cmdk-trigger' onClick={() => api.setOpen(true)}>
        Search… <kbd class='cmdk-kbd'>⌘K</kbd>
      </button>

      <Show when={api.open}>
        <div class='cmdk-backdrop' onClick={() => api.setOpen(false)}>
          <div class='cmdk-panel' onClick={e => e.stopPropagation()}>
            <input
              ref={el => (inputEl = el)}
              {...normalize(api.parts.input)}
              value={api.query}
              placeholder='Type a command…'
              class='cmdk-input'
            />
            <ul {...normalize(api.parts.root)} class='cmdk-list'>
              <Show when={api.results.length === 0}>
                <li class='cmdk-empty'>No results</li>
              </Show>
              <For each={api.results}>
                {(command, index) => {
                  const itemProps = () => normalize(api.parts.getItemProps(command, index()))
                  const selected = () => command.id === api.activeId
                  return (
                    <li {...itemProps()} class={['cmdk-item', { 'is-active': selected() }]}>
                      <span>{command.label}</span>
                      <Show when={command.hint}>
                        <kbd class='cmdk-kbd'>{command.hint}</kbd>
                      </Show>
                    </li>
                  )
                }}
              </For>
            </ul>
          </div>
        </div>
      </Show>
    </div>
  )
}
