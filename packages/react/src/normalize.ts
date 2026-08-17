/**
 * Translate the machine layer's logical surface to React DOM props.
 *
 * Input keys are the substrate-agnostic vocabulary a connect() emits
 * (`EventBindings` / `AttrBindings` in `@dunky.dev/state-machine-bindings`),
 * which is ARIA-shaped by design — see `ACCESSIBILITY.md`. The DOM is the
 * closest host to that vocabulary, so most attrs are a mechanical `aria-`
 * prefix and nothing is dropped. The parts that aren't mechanical:
 * - `onPress` → `onClick`: the DOM's activation event, which fires for
 *   keyboard Enter/Space on a native control too, not just a mouse press.
 * - `focusable` → `tabIndex` 0 / -1, not a boolean — `false` still has to
 *   leave the element focusable in script.
 * - `disabled` → `aria-disabled`, never the HTML `disabled` attribute: a
 *   disabled control stays in the tab order and keeps announcing itself,
 *   per APG. A consumer that wants the HTML attribute passes it themselves.
 * - `onValueChange`/`onWheel`/`onScroll`/`onScrollEnd` also have their
 *   argument translated — the DOM event is read into the neutral payload
 *   shape (see PAYLOAD_ADAPTERS), never forwarded raw.
 */
import type {
  AttrKey,
  AttrTargets,
  HandlerKey,
  HandlerTargets,
} from '@dunky.dev/state-machine-bindings'

export const HANDLER_MAP: HandlerTargets = {
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
  const pd = e?.preventDefault
  return pd && (() => pd.call(e))
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

export const ATTR_MAP: AttrTargets = {
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

    const handler = HANDLER_MAP[key as HandlerKey]
    if (handler) {
      const adapt = PAYLOAD_ADAPTERS[key]
      out[handler] = adapt ? (e: AnyEvent) => (value as (p: unknown) => void)(adapt(e)) : value
      continue
    }

    const attr = ATTR_MAP[key as AttrKey]
    if (attr) {
      out[attr] = key === 'focusable' ? (value ? 0 : -1) : value
      continue
    }

    out[key] = value
  }
  return out
}
