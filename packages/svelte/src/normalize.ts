/**
 * Translate the machine layer's logical surface to Svelte 5 DOM props.
 *
 * The DOM-shared half — the `aria-` attr projection and the payload adapters
 * — lives in `@dunky.dev/state-machine-dom` (see its header for the shared
 * decisions). This file adds only what is Svelte's own:
 * - Event props are the DOM's own handler attributes, `on` + the event type,
 *   lowercase and case-sensitive (Svelte reads `onClick` as a `Click` event).
 *   The map answers every vocabulary handler, so a new one fails to compile
 *   until it is mapped here.
 * - `focusable` → `tabindex` 0 / -1 — the attribute's own name, and not a
 *   boolean: `false` still has to leave the element focusable in script.
 * - ARIA booleans pass through: Svelte writes `false` on a non-boolean
 *   attribute as the literal "false" token.
 * - Symbol keys pass through: Svelte attachments ride on them.
 */
import type { AttrKey, AttrTargets, HandlerKey } from '@dunky.dev/state-machine-bindings'
import { DOM_ATTR_MAP, PAYLOAD_ADAPTERS, type AnyEvent } from '@dunky.dev/state-machine-dom'

export const HANDLER_MAP: Record<HandlerKey, string> = {
  onPress: 'onclick',
  onPointerEnter: 'onpointerenter',
  onPointerLeave: 'onpointerleave',
  onPointerMove: 'onpointermove',
  onPointerDown: 'onpointerdown',
  onPointerUp: 'onpointerup',
  onPointerCancel: 'onpointercancel',
  onFocus: 'onfocus',
  onBlur: 'onblur',
  onKeyDown: 'onkeydown',
  onKeyUp: 'onkeyup',
  onValueChange: 'oninput', // per change; `onchange` fires on commit
  onContextMenu: 'oncontextmenu',
  onDoublePress: 'ondblclick', // the DOM event is `dblclick`
  onWheel: 'onwheel',
  onScroll: 'onscroll',
  onScrollEnd: 'onscrollend',
}

export const ATTR_MAP: AttrTargets = {
  ...DOM_ATTR_MAP,
  focusable: 'tabindex', // value transformed below
}

export type Bindings = Record<string, unknown>

export function normalize(logical: Bindings): Record<string, unknown> {
  const out: Record<PropertyKey, unknown> = {}
  for (const key in logical) {
    const value = logical[key]
    if (value === undefined) continue

    const handler = HANDLER_MAP[key as HandlerKey]
    if (handler) {
      const adapt = PAYLOAD_ADAPTERS[key]
      // Wrap when the agnostic payload differs from the raw DOM event; else the
      // handler shape already matches (PointerPayload/KeyboardPayload), pass it.
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
  for (const key of Object.getOwnPropertySymbols(logical)) {
    out[key] = (logical as Record<PropertyKey, unknown>)[key]
  }
  return out
}
