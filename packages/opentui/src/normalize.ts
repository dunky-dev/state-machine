/**
 * Translate the machine layer's logical surface to OpenTUI (terminal) props.
 *
 * Notable differences from the DOM/RN normalizers:
 * - No ARIA tree — all ARIA attrs are dropped. `hidden` → `visible` (inverted); `disabled` passes through.
 * - Press is a mouse-button-down (`onPress` → `onMouseDown`); no synthetic click.
 * - `onWheel` → `onMouseScroll`; `onScroll`/`onScrollEnd` dropped (scrollbox has no scroll callback).
 * - `onValueChange` → `onChange`; adapter handles both bare string and `(index, option)` shapes.
 * - `onKeyUp` dropped — terminals deliver key presses, not up/down.
 * - `focusable` passes through as-is.
 */

import type {
  AnyAttrTargets,
  AnyHandlerTargets,
  AttrTargets,
  HandlerTargets,
} from '@dunky.dev/state-machine-bindings'

// The translation contract: every vocabulary key must appear — mapped or a
// declared `null` drop — so a new binding fails here until this target decides.
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
  // No OpenTUI analog — declared drops. `onFocus`/`onBlur`: OpenTUI signals
  // focus via the `focused` prop. `onScroll`/`onScrollEnd`: scrollbox has no
  // scroll-position callback. `onKeyUp`: terminals deliver presses, not up/down.
  onPointerCancel: null,
  onContextMenu: null,
  onDoublePress: null,
  onKeyUp: null,
  onScroll: null,
  onScrollEnd: null,
  onFocus: null,
  onBlur: null,
}

export const ATTR_MAP: AttrTargets = {
  // Visual analogs, routed in normalize(): `hidden` inverts into `visible`,
  // `focusable` is coerced to boolean.
  hidden: 'visible',
  focusable: 'focusable',
  disabled: 'disabled',
  // No ARIA tree in a terminal — the entire ARIA vocabulary is a declared drop.
  id: null,
  describedBy: null,
  labelledBy: null,
  controls: null,
  expanded: null,
  selected: null,
  modal: null,
  hasPopup: null,
  role: null,
  label: null,
  checked: null,
  pressed: null,
  current: null,
  busy: null,
  invalid: null,
  required: null,
  readOnly: null,
  activeDescendant: null,
  errorMessage: null,
  owns: null,
  valueMin: null,
  valueMax: null,
  valueNow: null,
  valueText: null,
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
  live: null,
  atomic: null,
}

const ANY_HANDLERS: AnyHandlerTargets = HANDLER_MAP
const ANY_ATTRS: AnyAttrTargets = ATTR_MAP

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

    const handler = ANY_HANDLERS[key]
    if (handler === null) continue
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

    const attr = ANY_ATTRS[key]
    if (attr === null) continue
    if (attr) {
      out[attr] = value
      continue
    }

    out[key] = value
  }

  return out
}
