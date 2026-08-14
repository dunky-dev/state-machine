/**
 * Translate the machine layer's logical surface to React Native props.
 *
 * How the maps are set up — and where each side comes from:
 * - Input keys are the substrate-agnostic vocabulary a connect() emits:
 *   `EventBindings` / `AttrBindings` in `@dunky.dev/state-machine-bindings`.
 *   Every vocabulary key must be accounted for here — mapped, folded, or a
 *   declared `null` drop; the `HandlerTargets`/`AttrTargets` contract makes an
 *   unlisted key a compile error instead of a silent leak to the host.
 * - Output keys are verified against RN's own vendored source, not its docs:
 *   - `ReactAndroid/.../uimanager/BaseViewManager.java` — the `@ReactProp`
 *     setters: which view props exist on Android and how each validates.
 *   - `ReactAndroid/.../uimanager/ReactAccessibilityDelegate.kt` — `Role`
 *     (web-aligned; unknown values resolve to null and degrade) vs
 *     `AccessibilityRole` (legacy enum whose `fromValue` throws natively on
 *     unknown values — never target it).
 *   - `Libraries/Components/View/ViewAccessibility.d.ts` — the accessibility
 *     prop surface; `AccessibilityState` has exactly the disabled / selected /
 *     checked / busy / expanded slots.
 *   - `React/Views/RCTViewManager.m` — the iOS side; values go through
 *     RCTConvert, which defaults instead of throwing.
 * - Rule for new mappings: only target props whose native setters degrade
 *   gracefully on values they don't recognize — Android setters that throw
 *   crash the whole surface at mount, before JS can catch anything.
 *
 * Notable differences from the DOM normalizer:
 * - `onPress` keeps its name; `onPointerDown`/`onPointerUp` → `onPressIn`/`onPressOut`.
 * - No hover — pointer move/enter/leave/cancel are dropped.
 * - `onContextMenu` → `onLongPress`; `onDoublePress`/`onWheel` dropped (no RN analog).
 * - `expanded`/`selected`/`disabled`/`checked`/`busy` fold into `accessibilityState`.
 * - `hidden` → `aria-hidden`: the web-aligned alias RN fans out per platform.
 * - `valueMin`/`valueMax`/`valueNow`/`valueText` fold into `accessibilityValue`.
 * - `live` → `accessibilityLiveRegion`; `'off'` → `'none'`.
 * - `controls`/`hasPopup`/`modal`/`describedBy` and most ARIA-only attrs are
 *   dropped (`describedBy`: RN has no describe-by-reference slot).
 * - `role` passes through unchanged: RN's web-aligned `role` prop takes the
 *   full ARIA vocabulary and degrades gracefully, while the legacy
 *   `accessibilityRole` enum throws natively on Android for values outside
 *   it (e.g. 'dialog').
 */

import type {
  AnyAttrTargets,
  AnyHandlerTargets,
  AttrTargets,
  HandlerTargets,
} from '@dunky.dev/state-machine-bindings'

// The translation contract: every vocabulary key must appear — mapped or a
// declared `null` drop — so a new binding fails here until this target decides.
export const HANDLER_MAP: AnyHandlerTargets = {
  onPress: 'onPress',
  onPointerDown: 'onPressIn',
  onPointerUp: 'onPressOut',
  onFocus: 'onFocus',
  onBlur: 'onBlur',
  onValueChange: 'onValueChange',
  onContextMenu: 'onLongPress',
  onScroll: 'onScroll',
  onScrollEnd: 'onMomentumScrollEnd',
  // No RN analog — declared drops.
  onPointerEnter: null,
  onPointerLeave: null,
  onPointerMove: null,
  onPointerCancel: null,
  onKeyDown: null,
  onKeyUp: null,
  onDoublePress: null,
  onWheel: null,
} satisfies HandlerTargets

export const ATTR_MAP: AnyAttrTargets = {
  // Android-only (iOS has no id-reference labelling); the setter takes a
  // nativeID string or an array (first element wins).
  labelledBy: 'accessibilityLabelledBy',
  id: 'nativeID',
  label: 'accessibilityLabel',
  // The web-aligned alias, not the legacy pair: RN's own components fan it out
  // per platform (accessibilityElementsHidden on iOS, no-hide-descendants on
  // Android) — accessibilityState has no hidden slot.
  hidden: 'aria-hidden',
  // RN's web-aligned `role` prop takes the full ARIA vocabulary and degrades
  // gracefully (never the legacy accessibilityRole enum, which throws).
  role: 'role',

  // Folded and special channels — named here for the ledger; normalize()
  // routes them before the plain-rename lookup.
  disabled: 'accessibilityState',
  expanded: 'accessibilityState',
  selected: 'accessibilityState',
  checked: 'accessibilityState',
  busy: 'accessibilityState',
  valueMin: 'accessibilityValue',
  valueMax: 'accessibilityValue',
  valueNow: 'accessibilityValue',
  valueText: 'accessibilityValue',
  focusable: 'focusable', // value coerced; also sets `accessible`
  live: 'accessibilityLiveRegion', // value transform: ARIA 'off' → RN 'none'

  // No clean RN analog — declared drops. `describedBy` included: RN has no
  // describe-by-reference slot (no aria-describedby); routing it into the
  // label slot would misname the element and clobber labelledBy.
  describedBy: null,
  controls: null,
  hasPopup: null,
  modal: null,
  pressed: null,
  current: null,
  invalid: null,
  required: null,
  readOnly: null,
  activeDescendant: null,
  errorMessage: null,
  owns: null,
  orientation: null,
  sort: null,
  autoComplete: null,
  multiline: null,
  multiSelectable: null,
  level: null,
  posInSet: null,
  setSize: null,
  colCount: null,
  colIndex: null,
  colSpan: null,
  rowCount: null,
  rowIndex: null,
  rowSpan: null,
  atomic: null,
} satisfies AttrTargets

// RN's accessibilityState slots — exactly these; anything else is stored and
// ignored. Derived from the ledger so the fold can't drift from it.
const A11Y_STATE_KEYS = new Set(
  Object.entries(ATTR_MAP)
    .filter(([, target]) => target === 'accessibilityState')
    .map(([key]) => key),
)

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

    const handler = HANDLER_MAP[key]
    if (handler === null) continue
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
    if (attr === null) continue
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
