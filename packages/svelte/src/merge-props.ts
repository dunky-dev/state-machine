type AnyProps = Record<string, unknown>
type AnyHandler = (...args: unknown[]) => unknown

// A Svelte DOM event prop: lowercase `on` + an event name (`onclick`,
// `onkeydown`, `onpointerenter`). This is where the Svelte merge diverges from
// the shared `baseMergeProps`, whose detector keys off React's camelCase form
// (`on` + an UPPERCASE letter). After `normalize`, the library props are all
// lowercase, so we chain on the lowercase shape instead.
const isEventHandlerKey = (key: string): boolean =>
  key.length > 2 && key.startsWith('on') && key[2] !== key[2]!.toUpperCase()

const isFn = (v: unknown): v is AnyHandler => typeof v === 'function'

function compose(consumer: AnyHandler, library: AnyHandler): AnyHandler {
  return (...args) => {
    consumer(...args)
    // Respect consumer's defaultPrevented — if the first arg looks like an event
    // whose default was prevented, the library handler is skipped. Matches the
    // Radix/Ark convention the React/base mergers use.
    const event = args[0] as { defaultPrevented?: boolean } | undefined
    if (event && typeof event === 'object' && event.defaultPrevented) return
    return library(...args)
  }
}

/**
 * Merge a consumer's props with the component's (library) props for the same
 * element — the Svelte counterpart of the React `mergeProps`.
 *
 * - **Event handlers are chained, consumer-first**, with the same
 *   `defaultPrevented` veto: if the consumer's handler prevents the event, the
 *   library's is skipped. Detection is on Svelte's lowercase `on*` props.
 * - **`class` is concatenated** with a single space and trimmed (`'a b'` + `'c'`
 *   → `'a b c'`), the Svelte attribute name (React's `className`). String + string
 *   only; otherwise library wins.
 * - **`style` is concatenated** as a string (Svelte styles are strings, not the
 *   React array form), joined with `; ` and trimmed. String + string only;
 *   otherwise library wins.
 * - **Everything else: library wins** — the component owns its semantics
 *   (`id`, `role`, `aria-*`).
 *
 * If the consumer passes no props, the library props are returned as-is.
 */
export function mergeProps(consumer: AnyProps | undefined, library: AnyProps): AnyProps {
  if (!consumer) return library
  const out: AnyProps = { ...consumer }

  for (const [key, libValue] of Object.entries(library)) {
    const consumerValue = consumer[key]

    if (isEventHandlerKey(key) && isFn(consumerValue) && isFn(libValue)) {
      out[key] = compose(consumerValue, libValue)
      continue
    }

    if (key === 'class' && typeof consumerValue === 'string' && typeof libValue === 'string') {
      out.class = `${consumerValue} ${libValue}`.trim()
      continue
    }

    if (key === 'style' && typeof consumerValue === 'string' && typeof libValue === 'string') {
      out.style = `${consumerValue.replace(/;\s*$/, '')}; ${libValue}`.trim()
      continue
    }

    // Default: library wins.
    out[key] = libValue
  }

  return out
}
