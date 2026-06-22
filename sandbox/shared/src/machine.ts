import { type Machine, setup } from '@dunky.dev/state-machine'
import { filterCommands } from './commands'
import type {
  CommandPaletteComputed,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteProps,
  CommandPaletteState,
} from './types'

// The palette is two states — `closed` / `open` — and ALL the interesting logic
// (filter, navigate with wraparound, clamp) lives in context + computed, driven
// by logical events. A renderer never computes an index; it sends `move`/`query.set`
// and reads `computed.results` / `activeId`. That's what makes the SAME machine
// run a browser ⌘K and a terminal fuzzy-finder unchanged.
const { createMachine } = setup
  .as<CommandPaletteContext, CommandPaletteEvent, CommandPaletteComputed>()
  .config({
    actions: {
      // Set the query and reset the highlight to the top of the new result set.
      setQuery: ({ event, setContext }) => {
        if (event.type !== 'query.set') return
        setContext({ query: event.query, activeIndex: 0 })
      },

      // Move the highlight within the FILTERED list, wrapping at both ends. Reads
      // the live result count off `computed`, so it's always against what's shown.
      move: ({ event, context, computed, setContext }) => {
        if (event.type !== 'move') return
        const count = computed.results.length
        if (count === 0) return
        const cur = context.activeIndex
        const next =
          event.to === 'first'
            ? 0
            : event.to === 'last'
              ? count - 1
              : event.to === 'down'
                ? (cur + 1) % count
                : (cur - 1 + count) % count
        setContext({ activeIndex: next })
      },

      // Jump straight to a row (pointer hover / click on a specific item).
      highlight: ({ event, computed, setContext }) => {
        if (event.type !== 'highlight') return
        const count = computed.results.length
        if (count === 0) return
        setContext({ activeIndex: Math.max(0, Math.min(event.index, count - 1)) })
      },

      // Stamp the highlighted command as executed. The nonce bumps every time so
      // the connector's reaction sees a fresh value and fires onSelect once per
      // Enter — even re-selecting the same row. No-op when nothing matches.
      execute: ({ context, computed, setContext }) => {
        const id = computed.activeId
        if (id === null) return
        const nonce = (context.lastExecuted?.nonce ?? 0) + 1
        setContext({ lastExecuted: { id, nonce } })
      },

      // Reset query + highlight so each open starts fresh.
      reset: ({ setContext }) => setContext({ query: '', activeIndex: 0 }),
    },
  })

/** Build the palette machine config from resolved props (read once to seed context). */
export function commandPaletteMachineConfig(props: CommandPaletteProps) {
  const context: CommandPaletteContext = {
    commands: props.commands,
    query: '',
    activeIndex: 0,
    lastExecuted: null,
  }

  return createMachine({
    initial: 'closed',
    context,

    computed: {
      // The filtered list — the single source of truth every renderer reads.
      results: ({ context }) => filterCommands(context.commands, context.query),
      // The highlighted command's id, clamped to the current results. `null` when
      // nothing matches. Renderers use it for activeDescendant / selected.
      activeId: ({ context }) => {
        const results = filterCommands(context.commands, context.query)
        const i = Math.max(0, Math.min(context.activeIndex, results.length - 1))
        return results[i]?.id ?? null
      },
    },

    states: {
      closed: {
        on: {
          open: { target: 'open', actions: ['reset'] },
        },
      },
      open: {
        on: {
          close: { target: 'closed' },
          'query.set': { actions: ['setQuery'] },
          move: { actions: ['move'] },
          highlight: { actions: ['highlight'] },
          // Stamp the selection (action), then close. The connector's reaction
          // observes the stamped value and fires onSelect; the state change to
          // `closed` fires onOpenChange(false). The machine never reads props.
          execute: { target: 'closed', actions: ['execute'] },
        },
      },
    },
  })
}

export type CommandPaletteMachineConfig = ReturnType<typeof commandPaletteMachineConfig>

export type CommandPaletteMachine = Machine<
  CommandPaletteState,
  CommandPaletteContext,
  CommandPaletteEvent,
  CommandPaletteComputed
>
