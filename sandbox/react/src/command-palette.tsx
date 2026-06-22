import { useEffect, useRef } from 'react'
import { type ComponentEffect, normalize, useMachine } from '@dunky.dev/react-state-machine'
import {
  commandPaletteMachineConfig,
  type CommandPaletteMachine,
  type CommandPaletteProps,
  connectCommandPalette,
} from '@sandbox/cmdk-core'

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

// The DOM renderer. It owns ZERO interaction logic — `useMachine` runs the shared
// machine, `connect` produces logical bindings, and `normalize` turns them into
// DOM props (onPress→onClick, role/aria-*, etc). The component is just markup.
export function CommandPalette(props: CommandPaletteProps) {
  const { api } = useMachine(
    commandPaletteMachineConfig,
    connectCommandPalette,
    [cmdkShortcut],
    props,
  )
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input whenever the palette opens (a renderer concern, not the
  // machine's — focus is a platform touchpoint).
  useEffect(() => {
    if (api.open) inputRef.current?.focus()
  }, [api.open])

  return (
    <div>
      <button type='button' style={styles.trigger} onClick={() => api.setOpen(true)}>
        Search… <kbd style={styles.kbd}>⌘K</kbd>
      </button>

      {api.open && (
        <div style={styles.backdrop} onClick={() => api.setOpen(false)}>
          <div style={styles.panel} onClick={e => e.stopPropagation()}>
            <input
              ref={inputRef}
              {...normalize(api.parts.input)}
              value={api.query}
              placeholder='Type a command…'
              style={styles.input}
            />
            <ul {...normalize(api.parts.root)} style={styles.list}>
              {api.results.length === 0 && <li style={styles.empty}>No results</li>}
              {api.results.map((command, index) => {
                const itemProps = normalize(api.parts.getItemProps(command, index))
                const selected = command.id === api.activeId
                return (
                  <li
                    key={command.id}
                    {...itemProps}
                    style={{ ...styles.item, ...(selected ? styles.itemActive : null) }}
                  >
                    <span>{command.label}</span>
                    {command.hint && <kbd style={styles.kbd}>{command.hint}</kbd>}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  trigger: {
    display: 'flex',
    justifyContent: 'space-between',
    minWidth: 300,
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    fontSize: 14,
    color: '#5b6172',
    background: '#fff',
    border: '1px solid rgba(13,15,22,0.12)',
    borderRadius: 10,
    cursor: 'pointer',
  },
  kbd: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 11,
    color: '#8990a0',
    background: 'rgba(13,15,22,0.05)',
    border: '1px solid rgba(13,15,22,0.08)',
    borderRadius: 6,
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
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(13,15,22,0.28)',
    overflow: 'hidden',
  },
  input: {
    width: '100%',
    minWidth: 300,
    boxSizing: 'border-box',
    padding: '18px 20px',
    fontSize: 16,
    border: 'none',
    borderBottom: '1px solid rgba(13,15,22,0.08)',
    outline: 'none',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  list: { listStyle: 'none', margin: 0, padding: 8, maxHeight: 320, overflowY: 'auto' },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 14,
    color: '#1c1e26',
    cursor: 'pointer',
  },
  itemActive: { background: 'rgba(91,115,255,0.12)', color: '#3142c4' },
  empty: { padding: '16px 12px', color: '#8990a0', fontSize: 14 },
}
