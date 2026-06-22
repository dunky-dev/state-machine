/**
 * Translate the machine layer's LOGICAL surface to OpenTUI (terminal) props.
 *
 * Logical handler → OpenTUI mouse/keyboard/value event prop
 * Logical attr    → OpenTUI prop, or dropped (the terminal has no ARIA tree)
 *
 * Pure object→object: this is the framework-agnostic OpenTUI translator (see
 * index.ts). What's substrate-specific is OpenTUI's terminal I/O model, and it
 * diverges from both DOM and RN. The handler/prop names below are the real ones
 * from `@opentui/core`'s Renderable and `@opentui/react`'s element types:
 *
 * - There is NO accessibility tree. A terminal has no screen-reader surface, so
 *   the entire ARIA attribute vocabulary (`role`, `label`, `describedBy`,
 *   `checked`, `expanded`, `valueNow`, the live-region + grid attrs, …) has no
 *   slot. Those attrs are DROPPED rather than passed through as invalid props.
 *   The two exceptions that DO have a visual analog are handled inline:
 *   `hidden` → `visible` (inverted), and `disabled` is preserved as `disabled`
 *   so the consuming component can dim/skip the renderable itself.
 *
 * - The pointer model is the MOUSE, reported in terminal cells. OpenTUI has no
 *   synthetic "click" — a press is a button-down at a cell — so `onPress` maps to
 *   `onMouseDown`. `onPointerDown`/`onPointerUp` map to `onMouseDown`/`onMouseUp`;
 *   `onPointerMove` → `onMouseMove`; `onPointerEnter`/`onPointerLeave` →
 *   `onMouseOver`/`onMouseOut` (OpenTUI's hover-equivalent over a cell region).
 *   `onPointerCancel` has no terminal analog → dropped.
 *
 * - `onContextMenu` (right-click / secondary activation) and `onDoublePress`
 *   have no dedicated OpenTUI slot — the raw `onMouse` catch-all carries the
 *   button/click-count, but there's no per-gesture handler — so both are dropped.
 *
 * - `onWheel` maps to `onMouseScroll` (terminal scroll IS a mouse-wheel event —
 *   core's MouseButton has WHEEL_UP/WHEEL_DOWN, and the event carries a `scroll`
 *   `{ direction, delta }`). `onScroll`/`onScrollEnd` are DROPPED: OpenTUI's
 *   `<scrollbox>` has no scroll-position callback prop — it exposes scroll STATE
 *   (`scrollTop`/`scrollLeft`/`scrollWidth`/`scrollHeight` getters on the ref) and
 *   handles the wheel internally, so there's nothing to bind a handler to.
 *
 * - `onValueChange` maps to OpenTUI's `onChange`. `<input>`'s `onChange` hands a
 *   bare string value; `<select>`/`<tab-select>`'s `onChange` hands
 *   `(index, option)`. The adapter handles both — `value` is the first arg, and a
 *   second arg (the option) rides along on the payload — so the component still
 *   receives a ChangePayload either way (see PAYLOAD_ADAPTERS).
 *
 * - `onKeyDown` maps to OpenTUI's `onKeyDown`; `onKeyUp` has no terminal analog
 *   (terminals deliver key PRESSES, not separate up/down) → dropped.
 *
 * - `focusable` passes through as the boolean `focusable` prop (OpenTUI's own
 *   focus flag — no tabIndex / accessible translation needed).
 */

const HANDLER_MAP: Record<string, string> = {
  // A press is a mouse button-down on a cell — OpenTUI has no synthetic click.
  onPress: 'onMouseDown',
  onPointerDown: 'onMouseDown',
  onPointerUp: 'onMouseUp',
  onPointerMove: 'onMouseMove',
  // Cell-region enter/leave is OpenTUI's hover-equivalent.
  onPointerEnter: 'onMouseOver',
  onPointerLeave: 'onMouseOut',
  onKeyDown: 'onKeyDown',
  // value-change → OpenTUI's onChange; wheel → onMouseScroll. onValueChange/onWheel
  // additionally have their argument translated into the agnostic payload (see
  // PAYLOAD_ADAPTERS). (onScroll/onScrollEnd are NOT here — see HANDLER_DROP.)
  onValueChange: 'onChange',
  onWheel: 'onMouseScroll',
}

// Handlers with no OpenTUI prop to bind to. We strip them rather than emit props
// the renderer ignores. (`onPointerCancel` — no touch-cancel; `onContextMenu`/
// `onDoublePress` — no per-gesture slot, only the raw onMouse catch-all; `onKeyUp`
// — terminals deliver key presses, not up/down; `onScroll`/`onScrollEnd` — a
// <scrollbox> has no scroll-position callback prop (scroll state is read off the
// ref's scrollTop/scrollLeft getters, not pushed to a handler); `onFocus`/`onBlur`
// — OpenTUI signals focus via the `focused` PROP, not element handlers.)
const HANDLER_DROP = new Set([
  'onPointerCancel',
  'onContextMenu',
  'onDoublePress',
  'onKeyUp',
  'onScroll',
  'onScrollEnd',
  'onFocus',
  'onBlur',
])

// The terminal has no accessibility tree, so the entire ARIA vocabulary has no
// slot. We drop these rather than forward them as props OpenTUI doesn't know.
// (`hidden` and `disabled` are NOT here — they have visual analogs, handled
// inline in normalize().)
const ATTR_DROP = new Set([
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

// Some handlers can't just be renamed: OpenTUI calls them with a different SHAPE
// (and arity) than the agnostic payload the component reads. We wrap those so the
// component still receives ChangePayload / WheelPayload. Adapters are VARIADIC:
// <select>'s onChange fires `(index, option)`, not a single arg. (onMouseDown/Up/
// Move/Over/Out and onKeyDown pass through unwrapped — PointerPayload/
// KeyboardPayload's optional fields tolerate OpenTUI's MouseEvent / key event.)

// `@opentui/core`'s MouseEvent carries the wheel info on `scroll`
// (parse.mouse.ts: `{ direction: 'up'|'down'|'left'|'right'; delta: number }`).
type OpenTUIMouseEvent = {
  scroll?: { delta?: number; direction?: 'up' | 'down' | 'left' | 'right' }
}

const PAYLOAD_ADAPTERS: Record<string, (...args: unknown[]) => unknown> = {
  // `<input>`'s onChange hands a bare string; `<select>`/`<tab-select>`'s onChange
  // hands `(index, option)`. Put the first arg on `value` (works for both — the
  // string, or the selected index) and forward a present second arg as `option`,
  // so a select-shaped component can read the chosen option off the payload.
  onValueChange: (value, option) => (option === undefined ? { value } : { value, option }),
  // Terminal wheel: a line-quantized delta off MouseEvent.scroll. 'up'/'left' are
  // negative (DOM convention); unit is 'line' since a terminal scrolls by rows.
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

    const handler = HANDLER_MAP[key]
    if (handler) {
      const adapt = PAYLOAD_ADAPTERS[key]
      // Wrap when OpenTUI's argument shape differs from the agnostic payload; else
      // the handler shape already matches, so pass it through. The wrapper is
      // variadic — <select>'s onChange fires `(index, option)`, so all args reach
      // the adapter.
      out[handler] = adapt
        ? (...args: unknown[]) => (value as (p: unknown) => void)(adapt(...args))
        : value
      continue
    }

    if (key === 'hidden') {
      // The terminal has no aria-hidden; the visual analog is not rendering it.
      out.visible = !value
      continue
    }

    if (key === 'focusable') {
      // OpenTUI's own focus flag — a plain boolean, no tabIndex/accessible dance.
      out.focusable = !!value
      continue
    }

    // `disabled` and any unknown attrs (e.g. data-state, style) pass through.
    out[key] = value
  }

  return out
}
