/**
 * Translate the machine layer's logical surface to Svelte 5 DOM props.
 *
 * The DOM-shared half — the `aria-` attr projection and the payload adapters
 * — lives in `@dunky.dev/state-machine-dom` (see its header for the shared
 * decisions). This file adds only what is Svelte's own:
 * - Event props are the DOM's handler attribute names, `on` + the event type,
 *   and case-sensitive (Svelte reads `onClick` as a `Click` event). The shared
 *   map's React-cased names are those same names camel-cased, so lowercasing
 *   derives them; the two keys it leaves out are named here: `onValueChange`
 *   → `oninput` (per change; `onchange` fires on commit) and `onDoublePress`
 *   → `ondblclick` (the DOM event is `dblclick`).
 * - `focusable` → `tabindex` 0 / -1 — the attribute's own name, and not a
 *   boolean: `false` still has to leave the element focusable in script.
 * - ARIA booleans pass through: Svelte writes `false` on a non-boolean
 *   attribute as the literal "false" token.
 */
import type {
  AttrKey,
  AttrTargets,
  HandlerKey,
  HandlerTargets,
} from '@dunky.dev/state-machine-bindings'
import {
  DOM_ATTR_MAP,
  DOM_HANDLER_MAP,
  PAYLOAD_ADAPTERS,
  type AnyEvent,
} from '@dunky.dev/state-machine-dom'

export const HANDLER_MAP: HandlerTargets = {
  ...Object.fromEntries(
    Object.entries(DOM_HANDLER_MAP).map(([key, prop]) => [key, prop.toLowerCase()]),
  ),
  onValueChange: 'oninput',
  onDoublePress: 'ondblclick',
}

export const ATTR_MAP: AttrTargets = {
  ...DOM_ATTR_MAP,
  focusable: 'tabindex', // value transformed below
}

export type Bindings = Record<string, unknown>

export function normalize(logical: Bindings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(logical)) {
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
  return out
}
