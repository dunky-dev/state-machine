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
// DOM props (onPress→onClick, role/aria-*, etc). The component is just markup;
// the look lives in the stylesheet shared with the Solid app.
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
      <button type='button' className='cmdk-trigger' onClick={() => api.setOpen(true)}>
        Search… <kbd className='cmdk-kbd'>⌘K</kbd>
      </button>

      {api.open && (
        <div className='cmdk-backdrop' onClick={() => api.setOpen(false)}>
          <div className='cmdk-panel' onClick={e => e.stopPropagation()}>
            <input
              ref={inputRef}
              {...normalize(api.parts.input)}
              value={api.query}
              placeholder='Type a command…'
              className='cmdk-input'
            />
            <ul {...normalize(api.parts.root)} className='cmdk-list'>
              {api.results.length === 0 && <li className='cmdk-empty'>No results</li>}
              {api.results.map((command, index) => {
                const itemProps = normalize(api.parts.getItemProps(command, index))
                const selected = command.id === api.activeId
                return (
                  <li
                    key={command.id}
                    {...itemProps}
                    className={selected ? 'cmdk-item is-active' : 'cmdk-item'}
                  >
                    <span>{command.label}</span>
                    {command.hint && <kbd className='cmdk-kbd'>{command.hint}</kbd>}
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
