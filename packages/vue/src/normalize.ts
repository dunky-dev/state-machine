/**
 * Translate the machine layer's logical surface to Vue DOM props — the shape
 * `h()` and a template `v-bind` spread take.
 *
 * The DOM-shared half — the `aria-` attr projection and the payload adapters
 * — lives in `@dunky.dev/state-machine-dom` (see its header for the shared
 * decisions). This file adds only what is Vue's own:
 * - Listener casing: Vue derives the DOM event from a listener prop by
 *   hyphenating its camel tail (`onPointerEnter` would listen to
 *   `pointer-enter`), so a multi-word event keeps only its leading capital:
 *   `onPointerenter`, `onKeydown`. The shared names are the camelCase of the
 *   same DOM events, so the Vue names are derived from them, never restated.
 * - `onValueChange` → `onInput`: the per-change event (`change` fires only on
 *   commit). Handlers receive native events; the shared adapters read them.
 * - `onDoublePress` → `onDblclick` (the DOM event is `dblclick`).
 * - `focusable` → `tabindex` 0 / -1 — the real attribute, and not a boolean:
 *   `false` still has to leave the element focusable in script.
 * - ARIA booleans pass through untransformed: Vue writes a non-boolean
 *   attribute's value as-is, so `true`/`false` render as the "true"/"false"
 *   tokens ARIA expects — on the client and in server rendering alike.
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

// `onPointerEnter` → `onPointerenter`: lowercase everything after the leading capital.
const toVueListener = (prop: string): string => prop.slice(0, 3) + prop.slice(3).toLowerCase()

export const HANDLER_MAP: HandlerTargets = {
  ...Object.fromEntries(
    Object.entries(DOM_HANDLER_MAP).map(([key, prop]) => [key, toVueListener(prop!)]),
  ),
  onValueChange: 'onInput',
  onDoublePress: 'onDblclick',
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
