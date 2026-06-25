/**
 * Translate the machine layer's logical surface to React Native props.
 *
 * Notable differences from the DOM normalizer:
 * - `onPress` keeps its name; `onPointerDown`/`onPointerUp` → `onPressIn`/`onPressOut`.
 * - No hover — pointer move/enter/leave/cancel are dropped.
 * - `onContextMenu` → `onLongPress`; `onDoublePress`/`onWheel` dropped (no RN analog).
 * - `expanded`/`selected`/`disabled`/`hidden`/`checked`/`busy` fold into `accessibilityState`.
 * - `valueMin`/`valueMax`/`valueNow`/`valueText` fold into `accessibilityValue`.
 * - `live` → `accessibilityLiveRegion`; `'off'` → `'none'`.
 * - `controls`/`hasPopup`/`modal` and most ARIA-only attrs are dropped.
 */

const HANDLER_MAP: Record<string, string> = {
  onPress: 'onPress',
  onPointerDown: 'onPressIn',
  onPointerUp: 'onPressOut',
  onFocus: 'onFocus',
  onBlur: 'onBlur',
  onValueChange: 'onValueChange',
  onContextMenu: 'onLongPress',
  onScroll: 'onScroll',
  onScrollEnd: 'onMomentumScrollEnd',
}

// No RN analog — stripped.
const HANDLER_DROP = new Set([
  'onPointerEnter',
  'onPointerLeave',
  'onPointerMove',
  'onPointerCancel',
  'onKeyDown',
  'onKeyUp',
  'onDoublePress',
  'onWheel',
])

const ATTR_MAP: Record<string, string> = {
  describedBy: 'accessibilityLabelledBy',
  labelledBy: 'accessibilityLabelledBy',
  role: 'accessibilityRole',
  id: 'nativeID',
  label: 'accessibilityLabel',
  // `live` needs a value transform ('off' → 'none'), handled inline in normalize().
}

// No clean RN analog — stripped.
const ATTR_DROP = new Set([
  'controls',
  'hasPopup',
  'modal',
  'pressed',
  'current',
  'invalid',
  'required',
  'readOnly',
  'activeDescendant',
  'errorMessage',
  'owns',
  'orientation',
  'sort',
  'autoComplete',
  'multiline',
  'multiSelectable',
  'level',
  'posInSet',
  'setSize',
  'colCount',
  'colIndex',
  'colSpan',
  'rowCount',
  'rowIndex',
  'rowSpan',
  'atomic',
])

// RN's accessibilityState slots.
const A11Y_STATE_KEYS = new Set(['disabled', 'expanded', 'selected', 'hidden', 'checked', 'busy'])

// Logical key → RN's accessibilityValue sub-key (`{ min, max, now, text }`).
const A11Y_VALUE_KEYS: Record<string, string> = {
  valueMin: 'min',
  valueMax: 'max',
  valueNow: 'now',
  valueText: 'text',
}

type RNScrollEvent = {
  nativeEvent?: {
    contentOffset?: { x?: number; y?: number }
    contentSize?: { width?: number; height?: number }
    layoutMeasurement?: { width?: number; height?: number }
  }
}

const PAYLOAD_ADAPTERS: Record<string, (arg: unknown) => unknown> = {
  onValueChange: value => ({ value }), // RN hands the bare value

  onScroll: scrollPayload,
  onScrollEnd: scrollPayload,
}

function scrollPayload(e: unknown): unknown {
  const n = (e as RNScrollEvent)?.nativeEvent ?? {}
  return {
    offsetX: n.contentOffset?.x,
    offsetY: n.contentOffset?.y,
    contentWidth: n.contentSize?.width,
    contentHeight: n.contentSize?.height,
    viewportWidth: n.layoutMeasurement?.width,
    viewportHeight: n.layoutMeasurement?.height,
  }
}

export type Bindings = Record<string, unknown>

export function normalize(logical: Bindings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const a11yState: Record<string, unknown> = {}
  let hasA11yState = false
  const a11yValue: Record<string, unknown> = {}
  let hasA11yValue = false

  for (const [key, value] of Object.entries(logical)) {
    if (value === undefined) continue

    if (HANDLER_DROP.has(key)) continue
    if (ATTR_DROP.has(key)) continue

    const handler = HANDLER_MAP[key]
    if (handler) {
      const adapt = PAYLOAD_ADAPTERS[key]
      out[handler] = adapt ? (arg: unknown) => (value as (p: unknown) => void)(adapt(arg)) : value
      continue
    }

    if (A11Y_STATE_KEYS.has(key)) {
      a11yState[key] = value
      hasA11yState = true
      continue
    }

    const valueKey = A11Y_VALUE_KEYS[key]
    if (valueKey) {
      a11yValue[valueKey] = value
      hasA11yValue = true
      continue
    }

    if (key === 'focusable') {
      out.focusable = !!value
      if (value) out.accessible = true // focusable must also be accessible for screen readers
      continue
    }

    if (key === 'live') {
      out.accessibilityLiveRegion = value === 'off' ? 'none' : value // ARIA 'off' → RN 'none'
      continue
    }

    const attr = ATTR_MAP[key]
    if (attr) {
      out[attr] = value
      continue
    }

    out[key] = value
  }

  if (hasA11yState) {
    out.accessibilityState = a11yState
  }
  if (hasA11yValue) {
    out.accessibilityValue = a11yValue
  }

  return out
}
