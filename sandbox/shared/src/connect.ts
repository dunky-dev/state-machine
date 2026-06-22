/**
 * cmdk connect — pure mapping from the machine snapshot (+ props) to the LOGICAL
 * surface each renderer spreads. Output is substrate-agnostic: agnostic handlers
 * (`onPress`, `onKeyDown`, `onValueChange`) and attrs (`role`, `activeDescendant`,
 * `selected`, `controls`, `focusable`). Each target's `normalize()` turns these
 * into DOM / OpenTUI / RN props — the connect itself knows none of that.
 *
 * Pure: runs on every snapshot read, fires no side effects. Consumer callbacks
 * (onSelect / onOpenChange) are fired by the connector via `reactions`, which
 * observe the machine — the machine never reads props.
 */
import { type Connect, makeReaction } from '@dunky.dev/state-machine'
import type { ChangePayload, KeyboardPayload } from '@dunky.dev/state-machine-bindings'
import type {
  Command,
  CommandPaletteComputed,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteProps,
  CommandPaletteState,
} from './types'

/** The view-facing api connect() produces. */
export interface CommandPaletteApi {
  open: boolean
  query: string
  results: Command[]
  activeId: string | null
  /** Imperative open/close (a trigger button calls this). */
  setOpen: (open: boolean) => void
  parts: {
    /** The listbox container — owns logical id relationships. */
    root: Record<string, unknown>
    /** The search input — value + key navigation. */
    input: Record<string, unknown>
    /** Per-row bindings. `index` is the row's position in the FILTERED list. */
    getItemProps: (command: Command, index: number) => Record<string, unknown>
  }
}

const LISTBOX_ID = 'cmdk:listbox'
const itemId = (id: string) => `cmdk:item:${id}`

export const connectCommandPalette: Connect<
  CommandPaletteState,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteProps,
  CommandPaletteApi,
  CommandPaletteComputed
> = ({ state, context, computed, send }) => {
  const open = state === 'open'
  const { results, activeId } = computed

  return {
    open,
    query: context.query,
    results,
    activeId,
    setOpen(next) {
      if (open === next) return
      send({ type: next ? 'open' : 'close' })
    },
    parts: {
      root: {
        role: 'listbox',
        id: LISTBOX_ID,
        // Virtual focus: focus stays in the input, the active row is named here.
        activeDescendant: activeId ? itemId(activeId) : undefined,
      },
      input: {
        role: 'combobox',
        focusable: true,
        controls: LISTBOX_ID,
        expanded: open,
        activeDescendant: activeId ? itemId(activeId) : undefined,
        // Typing updates the query; the renderer feeds the new value here.
        onValueChange: (event?: ChangePayload) =>
          send({ type: 'query.set', query: String(event?.value ?? '') }),
        // Logical key navigation — the renderer only maps a key name to a `move`,
        // the index math lives in the machine. Arrow/Home/End/Enter/Escape.
        onKeyDown: (event?: KeyboardPayload) => {
          switch (event?.key) {
            case 'ArrowDown':
              event.preventDefault?.()
              send({ type: 'move', to: 'down' })
              break
            case 'ArrowUp':
              event.preventDefault?.()
              send({ type: 'move', to: 'up' })
              break
            case 'Home':
              send({ type: 'move', to: 'first' })
              break
            case 'End':
              send({ type: 'move', to: 'last' })
              break
            case 'Enter':
              event.preventDefault?.()
              send({ type: 'execute' })
              break
            case 'Escape':
              send({ type: 'close' })
              break
          }
        },
      },
      getItemProps(command, index) {
        const selected = command.id === activeId
        return {
          role: 'option',
          id: itemId(command.id),
          selected,
          // Hover highlights; click executes that row.
          onPointerEnter: () => send({ type: 'highlight', index }),
          onPress: () => {
            send({ type: 'highlight', index })
            send({ type: 'execute' })
          },
        }
      },
    },
  }
}

// --- reactions: machine-state change → consumer callback, fired once each -----

const reaction = makeReaction<
  CommandPaletteState,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteProps,
  CommandPaletteComputed
>()

/** Open ⇄ close → onOpenChange. */
const onOpenChange = reaction(
  m => m.matches('open'),
  (open, props) => props.onOpenChange?.(open),
)

/**
 * Execution → onSelect(command). The selector returns the `lastExecuted` stamp
 * (the `{ id, nonce }` object); its identity changes on every execute (new nonce),
 * so the reaction fires once per Enter even when the same row is picked twice. The
 * callback resolves the id to a Command from context and hands it to the consumer.
 */
const onSelect = reaction(
  m => m.context.lastExecuted,
  (stamp, props) => {
    if (!stamp) return
    const command = props.commands.find(c => c.id === stamp.id)
    if (command) props.onSelect?.(command)
  },
)

connectCommandPalette.reactions = [onOpenChange, onSelect]
