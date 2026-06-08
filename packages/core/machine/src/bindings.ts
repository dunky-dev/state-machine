/**
 * Bindings — substrate-agnostic event + attribute vocabulary for machine
 * connect() outputs.
 *
 * Every component's machine speaks this vocabulary. The connect() return
 * produces `EventBindings` (handlers bound to gestures/inputs) and
 * `AttrBindings` (attributes bound to values). Each adapter translates
 * them to its renderer's native props:
 *
 *   React DOM   : machine-react/normalize   (onPress → onClick, …)
 *   Native (RN) : machine-native/normalize  (onPress → Pressable.onPress, …)
 *   Surface     : machine-surface/normalize (future)
 *
 * A part's surface is two buckets:
 *   - handlers (EventBindings)  — input → events
 *   - attrs    (AttrBindings)   — substrate attributes (id, role, aria-*)
 *
 * Semantic state (machine state, side, …) is NOT collapsed into `data-*` here.
 * Core stays agnostic; each adapter derives whatever `data-*` it wants from the
 * machine state + the part's own fields.
 *
 * The payload types below pin the fields a handler can rely on across
 * substrates. Anything substrate-specific (clientX, nativeEvent,
 * currentTarget) lives behind the adapter and is invisible to component
 * authors.
 */

// -----------------------------------------------------------------------------
// Event payloads
// -----------------------------------------------------------------------------

export interface PointerPayload {
  /** True when an upstream handler called preventDefault / equivalent. */
  defaultPrevented?: boolean
  /**
   * Cancels the substrate's default action for the event (e.g. on web,
   * stops a synthetic click on Space-keyup, suppresses form submission on
   * Enter, prevents the page from scrolling on Arrow keys). Adapters
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

  /**
   * The kind of popup this element opens (ARIA haspopup) — `'menu'`,
   * `'listbox'`, `'dialog'`, … or `true` for a generic popup. Substrates with
   * no popup concept ignore it.
   */
  hasPopup?: 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog' | boolean

  /**
   * Whether the element participates in keyboard focus.
   * Adapters map to `tabIndex` (web) / `accessible` (RN) / etc.
   */
  focusable?: boolean

  /** ARIA role on web; equivalent semantic tag on other substrates. */
  role?: string
}
