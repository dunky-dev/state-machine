/**
 * Translate the machine layer's LOGICAL surface to React DOM props.
 *
 * Logical handler  → DOM event prop
 * Logical attr     → DOM/ARIA attr
 */

const HANDLER_MAP: Record<string, string> = {
  onPress: 'onClick',
  onPointerEnter: 'onPointerEnter',
  onPointerLeave: 'onPointerLeave',
  onPointerMove: 'onPointerMove',
  onPointerDown: 'onPointerDown',
  onFocus: 'onFocus',
  onBlur: 'onBlur',
  onKeyDown: 'onKeyDown',
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
}

export type Bindings = Record<string, unknown>

export function normalize(logical: Bindings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(logical)) {
    if (value === undefined) continue

    const handler = HANDLER_MAP[key]
    if (handler) {
      out[handler] = value
      continue
    }

    const attr = ATTR_MAP[key]
    if (attr) {
      if (key === 'focusable') {
        out[attr] = value ? 0 : -1
      } else {
        out[attr] = value
      }
      continue
    }

    out[key] = value
  }
  return out
}
