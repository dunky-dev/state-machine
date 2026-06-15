/**
 * Translate the machine layer's LOGICAL surface to React Native props.
 *
 * Logical handler → RN gesture/event prop
 * Logical attr    → RN accessibility prop
 *
 * Differences from the React DOM normalizer worth flagging:
 *
 * - `onPress` keeps the same name (RN's Pressable.onPress).
 * - `onPointerDown`/`onPointerUp` map to RN's `onPressIn`/`onPressOut`.
 * - There's NO hover. `onPointerMove`/`onPointerEnter`/`onPointerLeave`/
 *   `onPointerCancel` are dropped silently — the consuming view is expected to
 *   use a long-press gesture for tooltip-like activation. Components that
 *   need hover-like activation on RN should rely on focus or long-press.
 * - `onFocus` / `onBlur` map to RN's TextInput-style focus events but
 *   only fire for focusable components.
 * - `onValueChange` maps to RN's shared value-change slot (`onValueChange` —
 *   Switch/Picker/Slider); `onContextMenu` maps to `onLongPress`;
 *   `onScroll`/`onScrollEnd` map to `onScroll`/`onMomentumScrollEnd` (scroll
 *   containers only). `onDoublePress` and `onWheel` have no RN analog → dropped.
 * - `describedBy` becomes `accessibilityLabelledBy` on Android; iOS
 *   doesn't have a direct equivalent (best to merge the description
 *   into accessibilityHint manually in the view).
 * - `expanded`, `selected`, `disabled`, `hidden`, plus `checked` and `busy`
 *   become entries in `accessibilityState` (the only slots RN actually has).
 * - `valueMin`/`valueMax`/`valueNow`/`valueText` fold into the nested
 *   `accessibilityValue` object (`{ min, max, now, text }`).
 * - `label` → `accessibilityLabel`; `live` → `accessibilityLiveRegion`
 *   (`'off'` becomes RN's `'none'`).
 * - `controls`, `hasPopup`, `modal` are DOM-ARIA-only and are dropped — RN
 *   overlays/modals are their own components, not element attributes. So are the
 *   ARIA attrs with no RN slot (`pressed`, `current`, `invalid`, `required`,
 *   `readOnly`, `activeDescendant`, `errorMessage`, `owns`, `orientation`,
 *   `sort`, `autoComplete`, `multiline`, `multiSelectable`, `level`, `posInSet`,
 *   `setSize`, the grid `col*`/`row*` set, `atomic`).
 * - `role` maps to RN's `accessibilityRole`.
 */

const HANDLER_MAP: Record<string, string> = {
  onPress: 'onPress',
  onPointerDown: 'onPressIn',
  onPointerUp: 'onPressOut',
  onFocus: 'onFocus',
  onBlur: 'onBlur',
  // value-change shares RN's onValueChange (Switch/Picker/Slider); context =
  // long-press; scroll/scroll-end attach to scroll-container components.
  onValueChange: 'onValueChange',
  onContextMenu: 'onLongPress',
  onScroll: 'onScroll',
  onScrollEnd: 'onMomentumScrollEnd',
}

// Handlers that have no RN analog. We strip them rather than crash.
// (`onWheel` — no wheel input; `onDoublePress` — RN has no built-in multi-tap.)
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
  // NOTE: `live` → accessibilityLiveRegion needs a value transform ('off' →
  // 'none'), so it's handled inline in normalize(), not through this map.
}

// Attrs with no clean RN analog — stripped rather than passed through as
// invalid props. `controls`/`hasPopup`/`modal` are DOM ARIA-only (RN menus and
// modals use their own overlay/Modal-component semantics); the rest are ARIA
// attrs RN has no accessibility slot for — components convey them another way
// (an error label, editable=false on TextInput, the native focus hierarchy, …).
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

// Attrs that fold into accessibilityState (RN's slots are exactly these).
const A11Y_STATE_KEYS = new Set(['disabled', 'expanded', 'selected', 'hidden', 'checked', 'busy'])

// Attrs that fold into the nested accessibilityValue object — logical key → RN
// sub-key. RN's AccessibilityValue is `{ min, max, now, text }`.
const A11Y_VALUE_KEYS: Record<string, string> = {
  valueMin: 'min',
  valueMax: 'max',
  valueNow: 'now',
  valueText: 'text',
}

// Like the DOM normalizer, some handlers can't just be renamed: RN delivers a
// different SHAPE than the agnostic payload the component reads. onValueChange
// gives a BARE value (Switch/Picker/Slider call `onValueChange(value)`);
// onScroll/onMomentumScrollEnd give `{ nativeEvent: { contentOffset,
// contentSize, layoutMeasurement } }`. We wrap those so the component still
// receives ChangePayload / ScrollPayload. (onPress/onPressIn/onPressOut/
// onLongPress/onFocus/onBlur pass through unwrapped — PointerPayload's optional
// fields tolerate RN's gesture-responder event.)
type RNScrollEvent = {
  nativeEvent?: {
    contentOffset?: { x?: number; y?: number }
    contentSize?: { width?: number; height?: number }
    layoutMeasurement?: { width?: number; height?: number }
  }
}

const PAYLOAD_ADAPTERS: Record<string, (arg: unknown) => unknown> = {
  // RN hands the new value directly.
  onValueChange: value => ({ value }),
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
      // Wrap when RN's argument shape differs from the agnostic payload; else
      // the handler shape already matches, so pass it through.
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
      // RN's `focusable` controls hardware-keyboard/D-pad focus; a focusable
      // element must also be `accessible` to be reachable by the screen reader.
      out.focusable = !!value
      if (value) out.accessible = true
      continue
    }

    if (key === 'live') {
      // RN's accessibilityLiveRegion uses 'none' where ARIA uses 'off'.
      out.accessibilityLiveRegion = value === 'off' ? 'none' : value
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
