import { composeHandlers } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>
type AnyHandler = (...args: unknown[]) => unknown
// Svelte attachments ride on symbol keys, so a merge must carry those too.
type Bag = Record<PropertyKey, unknown>

/**
 * Merge consumer props with the component's normalized props, Svelte-style:
 * the agnostic rules (handlers compose consumer-first with the
 * `defaultPrevented` veto, library wins) over every `on*` key — Svelte's event
 * props are the lowercase DOM names, which the shared base doesn't compose —
 * plus `class` joined (strings) or merged as `[consumer, library]` (other
 * shapes, resolved by Svelte's clsx), `style` strings joined with the library
 * last so it wins, and the consumer's `class`/`style` kept when the library's
 * is nullish. One pass: it runs on every spread.
 */
export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): Props & AnyProps {
  if (!consumer) return library as Props & AnyProps
  const own = consumer as Bag
  const theirs = library as Bag
  const merged: Bag = { ...own }

  for (const key in theirs) {
    const ours = own[key]
    const value = theirs[key]
    if (key.startsWith('on') && isFn(ours) && isFn(value)) {
      merged[key] = composeHandlers(ours, value)
    } else if (key === 'class') {
      if (value != null) merged.class = ours == null ? value : mergeClass(ours, value)
    } else if (key === 'style') {
      if (value != null)
        merged.style =
          typeof ours === 'string' && typeof value === 'string' ? `${ours}; ${value}` : value
    } else {
      merged[key] = value
    }
  }
  for (const key of Object.getOwnPropertySymbols(theirs)) merged[key] = theirs[key]

  return merged as Props & AnyProps
}

const isFn = (v: unknown): v is AnyHandler => typeof v === 'function'

// A joined string stays a string for consumers that interpolate `class`;
// arrays and objects only render through Svelte's clsx.
const mergeClass = (ours: unknown, theirs: unknown): unknown =>
  typeof ours === 'string' && typeof theirs === 'string'
    ? `${ours} ${theirs}`.trim()
    : [ours, theirs]
