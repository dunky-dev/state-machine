import type { AttrTargets, HandlerTargets } from '@dunky.dev/state-machine-bindings'

/**
 * Handler names shared verbatim by every DOM target. The two divergent keys
 * (`onValueChange`, `onDoublePress`) are deliberately absent — each target
 * adds its own.
 */
export const DOM_HANDLER_MAP: HandlerTargets = {
  onPress: 'onClick',
  onPointerEnter: 'onPointerEnter',
  onPointerLeave: 'onPointerLeave',
  onPointerMove: 'onPointerMove',
  onPointerDown: 'onPointerDown',
  onPointerUp: 'onPointerUp',
  onPointerCancel: 'onPointerCancel',
  onFocus: 'onFocus',
  onBlur: 'onBlur',
  onKeyDown: 'onKeyDown',
  onKeyUp: 'onKeyUp',
  onContextMenu: 'onContextMenu',
  onWheel: 'onWheel',
  onScroll: 'onScroll',
  onScrollEnd: 'onScrollEnd',
}

/**
 * The `aria-` projection of the logical attr vocabulary — pure DOM truth,
 * identical in every DOM target. `focusable` is deliberately absent: its
 * target prop differs in casing (React `tabIndex`, Solid `tabindex`).
 */
export const DOM_ATTR_MAP: AttrTargets = {
  describedBy: 'aria-describedby',
  labelledBy: 'aria-labelledby',
  controls: 'aria-controls',
  hasPopup: 'aria-haspopup',
  expanded: 'aria-expanded',
  selected: 'aria-selected',
  disabled: 'aria-disabled',
  hidden: 'aria-hidden',
  modal: 'aria-modal',
  role: 'role',
  id: 'id',

  // labeling
  label: 'aria-label',
  // widget state (values pass through untransformed here — booleans, the
  // 'mixed' tristate, and the aria-current / aria-invalid enums; a target's
  // normalize() may serialize further, e.g. Solid stringifies booleans)
  checked: 'aria-checked',
  pressed: 'aria-pressed',
  current: 'aria-current',
  busy: 'aria-busy',
  invalid: 'aria-invalid',
  required: 'aria-required',
  readOnly: 'aria-readonly',
  // relationships
  activeDescendant: 'aria-activedescendant',
  errorMessage: 'aria-errormessage',
  owns: 'aria-owns',
  // value / range
  valueMin: 'aria-valuemin',
  valueMax: 'aria-valuemax',
  valueNow: 'aria-valuenow',
  valueText: 'aria-valuetext',
  // structure / orientation
  orientation: 'aria-orientation',
  sort: 'aria-sort',
  autoComplete: 'aria-autocomplete',
  multiline: 'aria-multiline',
  multiSelectable: 'aria-multiselectable',
  level: 'aria-level',
  posInSet: 'aria-posinset',
  setSize: 'aria-setsize',
  // grid / table
  colCount: 'aria-colcount',
  colIndex: 'aria-colindex',
  colSpan: 'aria-colspan',
  rowCount: 'aria-rowcount',
  rowIndex: 'aria-rowindex',
  rowSpan: 'aria-rowspan',
  // live region
  live: 'aria-live',
  atomic: 'aria-atomic',
}

/**
 * The DOM event fields the payload adapters read. React's synthetic events
 * and Solid's native events expose the same names, so one shape serves both.
 */
export type AnyEvent = {
  target?: { value?: unknown; checked?: unknown; type?: string }
  currentTarget?: Record<string, number>
  deltaX?: number
  deltaY?: number
  deltaZ?: number
  deltaMode?: number
  defaultPrevented?: boolean
  preventDefault?: () => void
}

// DOM WheelEvent.deltaMode (0/1/2) → the neutral WheelPayload unit.
const WHEEL_UNIT = ['pixel', 'line', 'page'] as const

/**
 * Handlers whose agnostic payload differs from the raw DOM event, keyed by
 * LOGICAL name. A target's normalize() wraps the consumer handler so it
 * receives the neutral payload built here instead of the event.
 */
export const PAYLOAD_ADAPTERS: Record<string, (e: AnyEvent) => unknown> = {
  onValueChange: e => {
    const t = e?.target
    // checkbox/radio carry the boolean on `.checked`; everything else on `.value`.
    const value = t && (t.type === 'checkbox' || t.type === 'radio') ? t.checked : t?.value
    return { value, defaultPrevented: e?.defaultPrevented, preventDefault: boundPreventDefault(e) }
  },
  onWheel: e => ({
    deltaX: e?.deltaX,
    deltaY: e?.deltaY,
    deltaZ: e?.deltaZ,
    deltaUnit: WHEEL_UNIT[e?.deltaMode ?? 0] ?? 'pixel',
    defaultPrevented: e?.defaultPrevented,
    preventDefault: boundPreventDefault(e),
  }),
  onScroll: scrollPayload,
  onScrollEnd: scrollPayload,
}

// Keep `this = event`: a detached native preventDefault throws "illegal invocation".
function boundPreventDefault(e: AnyEvent): (() => void) | undefined {
  return e?.preventDefault?.bind(e)
}

function scrollPayload(e: AnyEvent): unknown {
  const el = e?.currentTarget ?? {}
  return {
    offsetX: el.scrollLeft,
    offsetY: el.scrollTop,
    contentWidth: el.scrollWidth,
    contentHeight: el.scrollHeight,
    viewportWidth: el.clientWidth,
    viewportHeight: el.clientHeight,
  }
}
