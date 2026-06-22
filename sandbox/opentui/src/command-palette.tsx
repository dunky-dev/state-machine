import { useKeyboard } from '@opentui/react'
// The opentui package is framework-agnostic — it ships only the prop translator.
// The lifecycle hook comes from the React binding (OpenTUI renders via a React
// reconciler), exactly as the opentui package's docs prescribe: bring your own
// framework hook, pair it with this `normalize`.
import { useMachine } from '@dunky.dev/react-state-machine'
import { normalize } from '@dunky.dev/opentui-state-machine'
import {
  commandPaletteMachineConfig,
  type CommandPaletteProps,
  connectCommandPalette,
} from '@sandbox/cmdk-core'

// The TERMINAL renderer. Identical wiring to the DOM version — `useMachine` runs
// the SAME shared machine, `connect` produces the SAME logical bindings — only
// `normalize` (from the opentui package) and the JSX elements differ. The index
// math, filtering, and selection all live in the shared machine, unchanged.
export function CommandPalette(props: CommandPaletteProps) {
  const { api, machine } = useMachine(commandPaletteMachineConfig, connectCommandPalette, [], props)

  // Starts closed — press Ctrl+K to open. (⌘K can't be used in a terminal:
  // macOS/Ghostty don't forward Cmd to the program — Cmd is an app/OS modifier —
  // so terminal palettes use Ctrl+K, exactly like fzf / lazygit.)

  // Terminal key handling is global (no per-element focus model like the DOM), so
  // navigation goes through useKeyboard → the same logical `move`/`execute`/`close`
  // events the DOM input's onKeyDown sends. The machine can't tell the difference.
  useKeyboard(key => {
    // Ctrl+K toggles. `super` covers the rare terminal that forwards Cmd via the
    // Kitty protocol (it lands on `super`, not `meta` — meta is Alt/Option).
    if (key.name === 'k' && (key.ctrl || key.super)) {
      machine.send({ type: api.open ? 'close' : 'open' })
      return
    }
    if (!api.open) return
    switch (key.name) {
      case 'down':
        machine.send({ type: 'move', to: 'down' })
        break
      case 'up':
        machine.send({ type: 'move', to: 'up' })
        break
      case 'home':
        machine.send({ type: 'move', to: 'first' })
        break
      case 'end':
        machine.send({ type: 'move', to: 'last' })
        break
      case 'return':
        machine.send({ type: 'execute' })
        break
      case 'escape':
        machine.send({ type: 'close' })
        break
    }
  })

  if (!api.open) {
    // A bare <text> (no wrapping box) so the parent column centers it exactly like
    // the title and lead. A wrapping <box> stretches to fill the row width and
    // left-aligns its child, which is what pushed the hint off-center.
    return <text>Press Ctrl+K to open the command palette…</text>
  }

  const rootProps = normalize(api.parts.root)
  const inputProps = normalize(api.parts.input)

  return (
    <box
      style={{
        border: true,
        padding: 1,
        width: 56,
        flexDirection: 'column',
      }}
      title=' Command Palette '
    >
      <input
        {...inputProps}
        focused
        value={api.query}
        placeholder='Type a command…'
        onInput={(value: string) => machine.send({ type: 'query.set', query: value })}
      />
      <box {...rootProps} style={{ flexDirection: 'column', marginTop: 1 }}>
        {api.results.length === 0 && <text fg='#8990a0'>No results</text>}
        {api.results.map(command => {
          const selected = command.id === api.activeId
          return (
            <box
              key={command.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                backgroundColor: selected ? '#3142c4' : undefined,
                paddingLeft: 1,
                paddingRight: 1,
              }}
            >
              <text>{command.label}</text>
              {command.hint && <text>{command.hint}</text>}
            </box>
          )
        })}
      </box>
    </box>
  )
}
