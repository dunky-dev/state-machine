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

import { DROPPED_ATTRS, DROPPED_HANDLERS } from '@dunky.dev/state-machine-bindings'
import type { AttrTargets, HandlerTargets } from '@dunky.dev/state-machine-bindings'

// The translation contract: the DROPPED_* spread declares everything a `null`
// drop; the entries after it are what this target can express — the
// annotation keeps the overrides typo-checked against the vocabulary.
//
// Dropped (via the spread) with intent, not just absence: `onFocus`/`onBlur` —
// OpenTUI signals focus via the `focused` prop; `onScroll`/`onScrollEnd` —
// scrollbox has no scroll-position callback; `onKeyUp` — terminals deliver
// presses, not up/down.
export const HANDLER_MAP: HandlerTargets = {
  ...DROPPED_HANDLERS,
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

export const ATTR_MAP: AttrTargets = {
  ...DROPPED_ATTRS, // no ARIA tree in a terminal — the whole vocabulary drops
  // Visual analogs, routed in normalize(): `hidden` inverts into `visible`,
  // `focusable` is coerced to boolean.
  hidden: 'visible',
  focusable: 'focusable',
  disabled: 'disabled',
}

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

    const handler = (HANDLER_MAP as Record<string, string | null | undefined>)[key]
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

    const attr = (ATTR_MAP as Record<string, string | null | undefined>)[key]
    if (attr === null) continue
    if (attr) {
      out[attr] = value
      continue
    }

    out[key] = value
  }

  return out
}
