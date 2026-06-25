// Translate the machine layer's logical surface to React DOM props.

const HANDLER_MAP: Record<string, string> = {
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
  // onValueChange/onWheel/onScroll/onScrollEnd also have their argument translated (see PAYLOAD_ADAPTERS).
  onValueChange: 'onChange',
  onContextMenu: 'onContextMenu',
  onDoublePress: 'onDoubleClick',
  onWheel: 'onWheel',
  onScroll: 'onScroll',
  onScrollEnd: 'onScrollEnd',
}

// DOM WheelEvent.deltaMode (0/1/2) → the neutral WheelPayload unit.
const WHEEL_UNIT = ['pixel', 'line', 'page'] as const

type AnyEvent = {
  target?: { value?: unknown; checked?: unknown; type?: string }
  currentTarget?: Record<string, number>
  deltaX?: number
  deltaY?: number
  deltaZ?: number
  deltaMode?: number
  defaultPrevented?: boolean
  preventDefault?: () => void
}

const PAYLOAD_ADAPTERS: Record<string, (e: AnyEvent) => unknown> = {
  onValueChange: e => {
    const t = e?.target
    const value = t && (t.type === 'checkbox' || t.type === 'radio') ? t.checked : t?.value
    return { value, defaultPrevented: e?.defaultPrevented, preventDefault: e?.preventDefault }
  },
  onWheel: e => ({
    deltaX: e?.deltaX,
    deltaY: e?.deltaY,
    deltaZ: e?.deltaZ,
    deltaUnit: WHEEL_UNIT[e?.deltaMode ?? 0] ?? 'pixel',
    defaultPrevented: e?.defaultPrevented,
    preventDefault: e?.preventDefault,
  }),
  onScroll: scrollPayload,
  onScrollEnd: scrollPayload,
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

const ATTR_MAP: Record<string, string> = {
  describedBy: 'aria-describedby',
  labelledBy: 'aria-labelledby',
  controls: 'aria-controls',
  hasPopup: 'aria-haspopup',
  expanded: 'aria-expanded',
  selected: 'aria-selected',
  disabled: 'aria-disabled',
  hidden: 'aria-hidden',
  modal: 'aria-modal',
  focusable: 'tabIndex', // value transformed below
  role: 'role',
  id: 'id',

  // labeling
  label: 'aria-label',
  // widget state (values pass through untransformed — booleans, the 'mixed'
  // tristate, and the aria-current / aria-invalid enums all serialize as-is)
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

export type Bindings = Record<string, unknown>

export function normalize(logical: Bindings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(logical)) {
    if (value === undefined) continue

    const handler = HANDLER_MAP[key]
    if (handler) {
      const adapt = PAYLOAD_ADAPTERS[key]
      out[handler] = adapt ? (e: AnyEvent) => (value as (p: unknown) => void)(adapt(e)) : value
      continue
    }

    const attr = ATTR_MAP[key]
    if (attr) {
      out[attr] = key === 'focusable' ? (value ? 0 : -1) : value
      continue
    }

    out[key] = value
  }
  return out
}
