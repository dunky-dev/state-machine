import { composeHandlers, mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>
type AnyHandler = (...args: unknown[]) => unknown

// The agnostic base composes only `on` + an uppercase letter; Svelte's event
// props are the lowercase DOM names (`onclick`), so those compose here.
const isLowercaseHandlerKey = (key: string): boolean => /^on[a-z]/.test(key)

/**
 * Merge consumer props with the component's normalized props, Svelte-style:
 * the substrate-agnostic mergeProps (handlers compose, library wins) over
 * Svelte's lowercase event props too, plus `class` of any shape merged as
 * `[consumer, library]` (Svelte resolves strings, arrays, and objects through
 * clsx) and overlapping `style` strings joined, library last so it wins.
 */
export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): Props & AnyProps {
  const merged: AnyProps = baseMergeProps(consumer as AnyProps | undefined, library)
  if (!consumer) return merged as Props & AnyProps
  const own = consumer as AnyProps

  for (const key in library) {
    const ours = own[key]
    const theirs = library[key]
    if (isLowercaseHandlerKey(key) && typeof ours === 'function' && typeof theirs === 'function') {
      merged[key] = composeHandlers(ours as AnyHandler, theirs as AnyHandler)
    }
  }
  if (own.class != null && library.class != null) {
    merged.class = [own.class, library.class]
  }
  if (typeof own.style === 'string' && typeof library.style === 'string') {
    merged.style = `${own.style}; ${library.style}`
  }

  return merged as Props & AnyProps
}
