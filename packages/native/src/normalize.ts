/**
 * Translate the machine layer's LOGICAL surface to React Native props.
 *
 * Logical handler → RN gesture/event prop
 * Logical attr    → RN accessibility prop
 *
 * Differences from the React DOM normalizer worth flagging:
 *
 * - `onPress` keeps the same name (RN's Pressable.onPress).
 * - There's NO hover. `onPointerMove`/`onPointerEnter`/`onPointerLeave`
 *   are dropped silently — the consuming view is expected to use a
 *   long-press gesture for tooltip-like activation. Components that
 *   need hover-like activation on RN should rely on focus or long-press.
 * - `onFocus` / `onBlur` map to RN's TextInput-style focus events but
 *   only fire for focusable components. The tooltip view doesn't lean
 *   on these on RN.
 * - `describedBy` becomes `accessibilityLabelledBy` on Android; iOS
 *   doesn't have a direct equivalent (best to merge the description
 *   into accessibilityHint manually in the view).
 * - `expanded`, `selected`, `disabled` become entries in
 *   `accessibilityState`.
 * - `role` maps to RN's `accessibilityRole`.
 */

const HANDLER_MAP: Record<string, string> = {
  onPress: 'onPress',
  onPointerDown: 'onPressIn',
  onPointerUp: 'onPressOut',
  onFocus: 'onFocus',
  onBlur: 'onBlur',
}

// Handlers that have no RN analog. We strip them rather than crash.
const HANDLER_DROP = new Set([
  'onPointerEnter',
  'onPointerLeave',
  'onPointerMove',
  'onPointerCancel',
  'onKeyDown',
  'onKeyUp',
])

const ATTR_MAP: Record<string, string> = {
  describedBy: 'accessibilityLabelledBy',
  labelledBy: 'accessibilityLabelledBy',
  role: 'accessibilityRole',
  id: 'nativeID',
}

// Attrs with no clean RN analog — stripped rather than passed through as
// invalid props. (`controls`/`hasPopup` are DOM ARIA-only; RN menus use their
// own overlay semantics.)
const ATTR_DROP = new Set(['controls', 'hasPopup'])

// Attrs that fold into accessibilityState.
const A11Y_STATE_KEYS = new Set(['disabled', 'expanded', 'selected', 'hidden'])

export type Bindings = Record<string, unknown>

export function normalize(logical: Bindings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const a11yState: Record<string, unknown> = {}
  let hasA11yState = false

  for (const [key, value] of Object.entries(logical)) {
    if (value === undefined) continue

    if (HANDLER_DROP.has(key)) continue
    if (ATTR_DROP.has(key)) continue

    const handler = HANDLER_MAP[key]
    if (handler) {
      out[handler] = value
      continue
    }

    if (A11Y_STATE_KEYS.has(key)) {
      a11yState[key] = value
      hasA11yState = true
      continue
    }

    if (key === 'focusable') {
      out.focusable = !!value
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

  return out
}
