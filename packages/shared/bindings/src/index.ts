// Substrate-agnostic binding vocabulary: event handlers and attributes a connect() emits.
// Each renderer's normalize() is the only code that turns these into platform props.

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

/**
 * The new value emitted by a value-producing control — a switch, checkbox,
 * radio group, slider, combobox, segmented control. `value` is intentionally
 * agnostic (`boolean | number | string | …`); each component narrows it for its
 * own widget. `preventDefault`/`defaultPrevented` mirror the pointer/keyboard
 * convention so a value change can be vetoed where the substrate supports it.
 */
export interface ChangePayload<Value = unknown> {
  value?: Value
  defaultPrevented?: boolean
  /** See PointerPayload.preventDefault. */
  preventDefault?: () => void
}

/**
 * Mousewheel / trackpad scroll deltas (sliders, scrollable surfaces). Web-only
 * in practice — RN has no wheel input, so the handler is dropped there.
 * `deltaUnit` is a NEUTRAL enum rather than the DOM `WheelEvent.deltaMode`
 * magic numbers (0/1/2): the payload stays substrate-agnostic.
 */
export interface WheelPayload {
  deltaX?: number
  deltaY?: number
  deltaZ?: number
  /** Unit the deltas are expressed in. */
  deltaUnit?: 'pixel' | 'line' | 'page'
  defaultPrevented?: boolean
  /** See PointerPayload.preventDefault — suppresses the substrate's default scroll. */
  preventDefault?: () => void
}

/**
 * A neutral scroll-position + geometry snapshot for scroll-container widgets
 * (listbox, combobox popup, menu, tree, grid) doing active-descendant tracking,
 * scroll-into-view, snap, or virtualized loading. Field names are
 * renderer-neutral — NOT the DOM `scrollTop`/`scrollWidth`/`clientWidth` names.
 * Each target's `normalize` CONSTRUCTS this shape from its native scroll event
 * (DOM reads `currentTarget.scroll*`; RN reads `nativeEvent.contentOffset` /
 * `contentSize` / `layoutMeasurement`) rather than forwarding the raw handler.
 * Read-only — no `preventDefault`.
 */
export interface ScrollPayload {
  offsetX?: number
  offsetY?: number
  contentWidth?: number
  contentHeight?: number
  viewportWidth?: number
  viewportHeight?: number
}

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

  /**
   * "the control's value changed" — switch/checkbox/radio/slider/combobox.
   * The renderer-neutral counterpart of the DOM `onChange`/`onInput` and RN
   * `onValueChange`. The new value rides on the payload.
   */
  onValueChange?: <Value = unknown>(event?: ChangePayload<Value>) => void

  /**
   * Secondary / alternate activation — right-click on web, long-press on touch.
   * (Context menus, rich editors.)
   */
  onContextMenu?: (event?: PointerPayload) => void

  /** Double activation — e.g. table-cell edit, word select. Web-forward; RN has
   * no built-in multi-tap, so it's dropped there. */
  onDoublePress?: (event?: PointerPayload) => void

  /** Mousewheel / trackpad deltas (sliders, scrollable lists). Web-only. */
  onWheel?: (event?: WheelPayload) => void

  /** Scroll-position change on a scroll container — active-descendant tracking,
   * scroll-into-view, virtualization. */
  onScroll?: (event?: ScrollPayload) => void
  /** Scroll deceleration complete — lazy-load / snap. */
  onScrollEnd?: (event?: ScrollPayload) => void
}

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

  // --- labeling -------------------------------------------------------------

  /** A direct string label, when there's no visible/`labelledBy` text. Primary
   * screen-reader exposure (web `aria-label`, RN `accessibilityLabel`). */
  label?: string

  // --- widget state ---------------------------------------------------------

  /** Checkbox / radio / toggle tristate. `'mixed'` is an indeterminate group. */
  checked?: boolean | 'mixed'
  /** Toggle-button pressed state (tristate). Web-forward. */
  pressed?: boolean | 'mixed'
  /** Marks the current item within a set — the current page/step/etc. */
  current?: 'page' | 'step' | 'location' | 'date' | 'time' | boolean
  /** The element is being updated and not yet interactive. */
  busy?: boolean
  /** Validity of a user-entered value. */
  invalid?: boolean | 'grammar' | 'spelling'
  /** User input is required before submission. */
  required?: boolean
  /** The value is not editable but is otherwise operable. */
  readOnly?: boolean

  // --- relationships --------------------------------------------------------

  /** The id of the descendant a composite widget (menu/listbox/combobox/grid)
   * treats as virtually focused while DOM focus stays on the container. */
  activeDescendant?: string
  /** The id of the element describing this one's validation error. Paired with
   * `invalid` to be announced. */
  errorMessage?: string
  /** The ids of elements this one owns when the DOM hierarchy can't express it. */
  owns?: string

  // --- value / range (sliders, spinbuttons, progress) -----------------------

  valueMin?: number
  valueMax?: number
  valueNow?: number
  /** A human-readable form of `valueNow` ("70%", "Medium"). */
  valueText?: string

  // --- structure / orientation ----------------------------------------------

  orientation?: 'horizontal' | 'vertical'
  /** Sort direction of a sortable column header. */
  sort?: 'ascending' | 'descending' | 'none' | 'other'
  /** A combobox/textbox's autocomplete behavior. */
  autoComplete?: 'none' | 'inline' | 'list' | 'both'
  /** A textbox accepts multiple lines. */
  multiline?: boolean
  /** More than one item may be selected at once. */
  multiSelectable?: boolean
  /** Hierarchical level (tree item, heading, nested group). 1-based. */
  level?: number
  /** 1-based position of this item within its set. */
  posInSet?: number
  /** Total size of the set this item belongs to (for virtualized lists). */
  setSize?: number

  // --- grid / table ----------------------------------------------------------

  colCount?: number
  colIndex?: number
  colSpan?: number
  rowCount?: number
  rowIndex?: number
  rowSpan?: number

  // --- live region -----------------------------------------------------------

  /** How assertively a live region announces updates. */
  live?: 'off' | 'polite' | 'assertive'
  /** Announce the whole region (true) or just the changed node (false). */
  atomic?: boolean
}
