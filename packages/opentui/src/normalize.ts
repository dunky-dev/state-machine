/**
 * Translate the machine layer's logical surface to OpenTUI (terminal) props.
 *
 * Notable differences from the DOM/RN normalizers:
 * - No ARIA tree — all ARIA attrs are dropped. `hidden` → `visible` (inverted); `disabled` passes through.
 * - Press is a mouse-button-down (`onPress` → `onMouseDown`); no synthetic click.
 * - `onWheel` → `onMouseScroll`; `onScroll`/`onScrollEnd` dropped (scrollbox has no scroll callback).
 * - `onValueChange` → `onChange`; adapter handles both bare string and `(index, option)` shapes.
 * - `onKeyUp` dropped — terminals deliver key presses, not up/down.
 * - `onFocus`/`onBlur` dropped — OpenTUI signals focus via the `focused` prop.
 * - `focusable` passes through as-is.
 */

import type {
  AttrKey,
  AttrTargets,
  HandlerKey,
  HandlerTargets,
} from '@dunky.dev/state-machine-bindings'

export const HANDLER_MAP: HandlerTargets = {
  onPress: 'onMouseDown', // no synthetic click — a press is a button-down
  onPointerDown: 'onMouseDown',
  onPointerUp: 'onMouseUp',
  onPointerMove: 'onMouseMove',
  onPointerEnter: 'onMouseOver',
  onPointerLeave: 'onMouseOut',
  onKeyDown: 'onKeyDown',
  onValueChange: 'onChange',
  onWheel: 'onMouseScroll',
}

// no terminal analog — see the header for the intent behind each drop
export const HANDLER_DROP: ReadonlySet<string> = new Set<HandlerKey>([
  'onPointerCancel',
  'onFocus',
  'onBlur',
  'onKeyUp',
  'onContextMenu',
  'onDoublePress',
  'onScroll',
  'onScrollEnd',
])

// visual analogs — routed in normalize()
export const ATTR_MAP: AttrTargets = {
  hidden: 'visible',
  focusable: 'focusable',
  disabled: 'disabled',
}

// no ARIA tree in a terminal — the whole vocabulary drops
export const ATTR_DROP: ReadonlySet<string> = new Set<AttrKey>([
  'id',
  'describedBy',
  'labelledBy',
  'controls',
  'expanded',
  'selected',
  'modal',
  'hasPopup',
  'role',
  'label',
  'checked',
  'pressed',
  'current',
  'busy',
  'invalid',
  'required',
  'readOnly',
  'activeDescendant',
  'errorMessage',
  'owns',
  'valueMin',
  'valueMax',
  'valueNow',
  'valueText',
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
  'live',
  'atomic',
])

// Adapters are variadic — <select>'s onChange fires `(index, option)`, not a single arg.

// `@opentui/core`'s MouseEvent carries the wheel info on `scroll`
// (parse.mouse.ts: `{ direction: 'up'|'down'|'left'|'right'; delta: number }`).
type OpenTUIMouseEvent = {
  scroll?: { delta?: number; direction?: 'up' | 'down' | 'left' | 'right' }
}

const PAYLOAD_ADAPTERS: Record<string, (...args: unknown[]) => unknown> = {
  // First arg is the value (string from <input>, index from <select>); second arg is the option if present.
  onValueChange: (value, option) => (option === undefined ? { value } : { value, option }),
  // Terminal wheel: line-quantized delta; 'up'/'left' are negative (DOM convention).
  onWheel: e => {
    const s = (e as OpenTUIMouseEvent)?.scroll
    const magnitude = s?.delta ?? 0
    const negative = s?.direction === 'up' || s?.direction === 'left'
    const delta = negative ? -magnitude : magnitude
    // direction left/right rides on deltaX; up/down on deltaY.
    const horizontal = s?.direction === 'left' || s?.direction === 'right'
    return horizontal ? { deltaX: delta, deltaUnit: 'line' } : { deltaY: delta, deltaUnit: 'line' }
  },
}

export type Bindings = Record<string, unknown>

export function normalize(logical: Bindings): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(logical)) {
    if (value === undefined) continue

    if (HANDLER_DROP.has(key)) continue
    if (ATTR_DROP.has(key)) continue

    const handler = HANDLER_MAP[key as HandlerKey]
    if (handler) {
      const adapt = PAYLOAD_ADAPTERS[key]
      out[handler] = adapt
        ? (...args: unknown[]) => (value as (p: unknown) => void)(adapt(...args))
        : value
      continue
    }

    if (key === 'hidden') {
      out.visible = !value // no aria-hidden in a terminal; visual analog is not rendering
      continue
    }

    if (key === 'focusable') {
      out.focusable = !!value
      continue
    }

    const attr = ATTR_MAP[key as AttrKey]
    if (attr) {
      out[attr] = value
      continue
    }

    out[key] = value
  }

  return out
}
