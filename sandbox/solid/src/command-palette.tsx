import { createEffect, For, type JSX, Show } from 'solid-js'
import { type ComponentEffect, normalize, useMachine } from '@dunky.dev/state-machine-solid'
import {
  commandPaletteMachineConfig,
  type CommandPaletteMachine,
  type CommandPaletteProps,
  connectCommandPalette,
} from '@sandbox/cmdk-core'

// Global ⌘K / Ctrl+K to open — a PLATFORM listener (a document key event), so it
// lives here as a component effect, not in the machine. The machine just receives
// `open`. This is the per-target "behavior meets platform" seam — and the tuple
// is byte-for-byte the same shape the React sandbox uses.
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

// The DOM renderer. It owns ZERO interaction logic — `useMachine` runs the shared
// machine, `connect` produces logical bindings, and `normalize` turns them into
// DOM props (onPress→onClick, role/aria-*, etc). `api` is a fine-grained Solid
// store: reading `api.open` / `api.results` in JSX tracks exactly those fields.
export function CommandPalette(props: CommandPaletteProps) {
  const { api } = useMachine(
    commandPaletteMachineConfig,
    connectCommandPalette,
    [cmdkShortcut],
    props,
  )

  let inputEl: HTMLInputElement | undefined

  // Focus the input whenever the palette opens (a renderer concern, not the
  // machine's — focus is a platform touchpoint). createEffect tracks `api.open`.
  createEffect(() => {
    if (api.open) inputEl?.focus()
  })

  return (
    <div>
      <button type='button' style={styles.trigger} onClick={() => api.setOpen(true)}>
        Search… <kbd style={styles.kbd}>⌘K</kbd>
      </button>

      <Show when={api.open}>
        <div style={styles.backdrop} onClick={() => api.setOpen(false)}>
          <div style={styles.panel} onClick={e => e.stopPropagation()}>
            <input
              ref={el => (inputEl = el)}
              {...normalize(api.parts.input)}
              value={api.query}
              placeholder='Type a command…'
              style={styles.input}
            />
            <ul {...normalize(api.parts.root)} style={styles.list}>
              <Show when={api.results.length === 0}>
                <li style={styles.empty}>No results</li>
              </Show>
              <For each={api.results}>
                {(command, index) => {
                  const itemProps = () => normalize(api.parts.getItemProps(command, index()))
                  const selected = () => command.id === api.activeId
                  return (
                    <li
                      {...itemProps()}
                      style={{ ...styles.item, ...(selected() ? styles.itemActive : null) }}
                    >
                      <span>{command.label}</span>
                      <Show when={command.hint}>
                        <kbd style={styles.kbd}>{command.hint}</kbd>
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

const styles: Record<string, JSX.CSSProperties> = {
  trigger: {
    display: 'flex',
    'justify-content': 'space-between',
    'min-width': '300px',
    'align-items': 'center',
    gap: '8px',
    padding: '10px 14px',
    'font-size': '14px',
    color: '#5b6172',
    background: '#fff',
    border: '1px solid rgba(13,15,22,0.12)',
    'border-radius': '10px',
    cursor: 'pointer',
  },
  kbd: {
    'font-family': 'ui-monospace, monospace',
    'font-size': '11px',
    color: '#8990a0',
    background: 'rgba(13,15,22,0.05)',
    border: '1px solid rgba(13,15,22,0.08)',
    'border-radius': '6px',
    padding: '2px 6px',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(13,15,22,0.35)',
    display: 'flex',
    'justify-content': 'center',
    'align-items': 'flex-start',
    'padding-top': '14vh',
  },
  panel: {
    width: 'min(560px, 92vw)',
    background: '#fff',
    'border-radius': '14px',
    'box-shadow': '0 24px 64px rgba(13,15,22,0.28)',
    overflow: 'hidden',
  },
  input: {
    width: '100%',
    'min-width': '300px',
    'box-sizing': 'border-box',
    padding: '18px 20px',
    'font-size': '16px',
    border: 'none',
    'border-bottom': '1px solid rgba(13,15,22,0.08)',
    outline: 'none',
    'border-top-left-radius': '8px',
    'border-top-right-radius': '8px',
  },
  list: {
    'list-style': 'none',
    margin: 0,
    padding: '8px',
    'max-height': '320px',
    'overflow-y': 'auto',
  },
  item: {
    display: 'flex',
    'justify-content': 'space-between',
    'align-items': 'center',
    padding: '10px 12px',
    'border-radius': '8px',
    'font-size': '14px',
    color: '#1c1e26',
    cursor: 'pointer',
  },
  itemActive: { background: 'rgba(91,115,255,0.12)', color: '#3142c4' },
  empty: { padding: '16px 12px', color: '#8990a0', 'font-size': '14px' },
}
