/**
 * Translate the machine layer's logical surface to Solid DOM props.
 *
 * The DOM-shared half — the `aria-` attr projection and the payload adapters
 * — lives in `@dunky.dev/state-machine-dom` (see its header for the shared
 * decisions). This file adds only what is Solid's own:
 * - `onValueChange` → `onInput`: Solid's per-change event (Solid's `onChange`
 *   fires only on commit). Handlers receive NATIVE events, not synthetics —
 *   the shared adapters read the same field names either way.
 * - `onDoublePress` → `onDblClick` (Solid's DOM-cased prop).
 * - `focusable` → `tabindex` 0 / -1 — lowercase (the real attribute), and not
 *   a boolean: `false` still has to leave the element focusable in script.
 * - ARIA boolean values are stringified: Solid 2.0 treats a boolean attribute
 *   as presence/absence, but ARIA states are literal "true"/"false" tokens.
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
  ...DOM_HANDLER_MAP,
  onValueChange: 'onInput',
  onDoublePress: 'onDblClick',
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
      if (key === 'focusable') {
        out[attr] = value ? 0 : -1
      } else if (typeof value === 'boolean' && attr.startsWith('aria-')) {
        // Solid 2.0 treats a boolean attribute as presence/absence; ARIA
        // states are literal "true"/"false" tokens, so serialize explicitly.
        out[attr] = String(value)
      } else {
        out[attr] = value
      }
      continue
    }

    out[key] = value
  }
  return out
}
