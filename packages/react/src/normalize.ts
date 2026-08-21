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
  onValueChange: 'onChange',
  onDoublePress: 'onDoubleClick',
}

export const ATTR_MAP: AttrTargets = {
  ...DOM_ATTR_MAP,
  focusable: 'tabIndex', // value transformed below
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
