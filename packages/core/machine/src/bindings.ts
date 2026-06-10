// -----------------------------------------------------------------------------
// Event payloads
// -----------------------------------------------------------------------------

export interface PointerPayload {
  /** True when an upstream handler called preventDefault / equivalent. */
  defaultPrevented?: boolean
  /**
   * Cancels the substrate's default action for the event (e.g. on web,
   * stops a synthetic click on Space-keyup, suppresses form submission on
   * Enter, prevents the page from scrolling on Arrow keys). Targets
   * wire this to the native event's preventDefault when available;
   * substrates that have no concept of default action provide a no-op.
   */
  preventDefault?: () => void
  /** Pointer button number. 0 is primary on every substrate. */
  button?: number
  /** Input modality. Canvas/RN can supply "touch" or "mouse"; web supplies all three. */
  pointerType?: 'mouse' | 'touch' | 'pen'
}

export interface KeyboardPayload {
  defaultPrevented?: boolean
  /** See PointerPayload.preventDefault. */
  preventDefault?: () => void
  /** Logical key name. Matches `KeyboardEvent.key` on web. */
  key?: string
}

// -----------------------------------------------------------------------------
// Event bindings — handlers bound to user input
// -----------------------------------------------------------------------------

export interface EventBindings {
  /** "user clicked / tapped / activated this thing." */
  onPress?: (event?: PointerPayload) => void

  onPointerEnter?: (event?: PointerPayload) => void
  onPointerLeave?: (event?: PointerPayload) => void
  onPointerMove?: (event?: PointerPayload) => void
  onPointerDown?: (event?: PointerPayload) => void
  onPointerUp?: (event?: PointerPayload) => void
  onPointerCancel?: (event?: PointerPayload) => void

  onFocus?: () => void
  onBlur?: () => void

  onKeyDown?: (event?: KeyboardPayload) => void
  onKeyUp?: (event?: KeyboardPayload) => void
}

// -----------------------------------------------------------------------------
// Attr bindings — attributes bound to values
// -----------------------------------------------------------------------------

export interface AttrBindings {
  id?: string

  /** "this element's description is over there" (ARIA describedby). */
  describedBy?: string
  /** "this element's label is over there" (ARIA labelledby). */
  labelledBy?: string
  /** "this element controls that one" (ARIA controls) — e.g. a trigger naming
   * the menu surface it toggles. */
  controls?: string

  /** Boolean state (open/closed disclosure regions). */
  expanded?: boolean
  selected?: boolean
  disabled?: boolean
  hidden?: boolean
  /** Marks a surface as a modal layer (ARIA aria-modal) — content outside it is
   * inert. Substrates with no modal concept ignore it. */
  modal?: boolean

  /**
   * The kind of popup this element opens (ARIA haspopup) — `'menu'`,
   * `'listbox'`, `'dialog'`, … or `true` for a generic popup. Substrates with
   * no popup concept ignore it.
   */
  hasPopup?: 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog' | boolean

  /**
   * Whether the element participates in keyboard focus.
   * Targets map to `tabIndex` (web) / `accessible` (RN) / etc.
   */
  focusable?: boolean

  /** ARIA role on web; equivalent semantic tag on other substrates. */
  role?: string
}
