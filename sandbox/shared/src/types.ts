// =============================================================================
// cmdk — shared types
//
// The command-palette demo. ONE machine + connect() drives a ⌘K palette that
// renders identically on the DOM, in a terminal (OpenTUI), and on React Native.
// These types are the contract between the agnostic core and every renderer.
// =============================================================================

/** A single command in the palette. `id` is stable; `label`/`hint` are display. */
export interface Command {
  id: string
  label: string
  hint?: string
  /** A group heading the renderer can show ("Navigation", "Actions", …). */
  group?: string
}

/** The machine's mutable context. */
export interface CommandPaletteContext {
  /** Every command, in source order. Filtering is derived, never stored. */
  commands: Command[]
  /** Current search query. */
  query: string
  /** Highlighted row, as an index into the FILTERED list. */
  activeIndex: number
  /**
   * The last executed command, stamped by the `execute` action. The `nonce`
   * makes each execution a DISTINCT value so the connector's reaction fires once
   * per Enter even when the same command is picked twice — the machine's
   * prop-free way to signal "a selection happened" (the reaction reads it and
   * calls onSelect). `null` until the first execution.
   */
  lastExecuted: { id: string; nonce: number } | null
}

/** Events the palette accepts. All navigation is logical — the renderer only
 * translates a key/press into one of these; the index math lives in the machine. */
export type CommandPaletteEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'query.set'; query: string }
  | { type: 'move'; to: 'up' | 'down' | 'first' | 'last' }
  | { type: 'highlight'; index: number }
  | { type: 'execute' }

/** Derived state — the filtered list + the clamped active id, memoized. */
export interface CommandPaletteComputed {
  results: Command[]
  activeId: string | null
}

export type CommandPaletteState = 'closed' | 'open'

/** Consumer-facing props (callbacks + initial data). Read once to seed context. */
export interface CommandPaletteProps {
  commands: Command[]
  /** Fired when a command is executed (Enter / click on a row). */
  onSelect?: (command: Command) => void
  /** Fired whenever the palette opens or closes. */
  onOpenChange?: (open: boolean) => void
}
