import { composeHandlers, mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>
type AnyHandler = (...args: unknown[]) => unknown

/**
 * Merge consumer props with the component's normalized props, Vue-style: the
 * substrate-agnostic mergeProps (handlers chain consumer-first with the
 * `defaultPrevented` veto, library wins otherwise) plus Vue's own shapes:
 * - `class` / `style` set on both sides merge as `[consumer, library]` — Vue
 *   normalizes arrays of every class/style form, and the later entry wins a
 *   conflicting style key;
 * - an array of consumer handlers (what Vue's own mergeProps puts in `attrs`
 *   when a listener is bound twice) composes like a single handler.
 *
 * Not Vue's `mergeProps`, which concatenates handlers with no veto.
 */
export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): Props & AnyProps {
  const merged: AnyProps = baseMergeProps(consumer as AnyProps | undefined, library)
  if (!consumer) return merged as Props & AnyProps
  const own = consumer as AnyProps

  if (own.class != null && library.class != null) merged.class = [own.class, library.class]
  if (own.style != null && library.style != null) merged.style = [own.style, library.style]

  for (const key in library) {
    const handlers = own[key]
    const libHandler = library[key]
    if (Array.isArray(handlers) && typeof libHandler === 'function' && key.startsWith('on')) {
      const callAll: AnyHandler = (...args) => {
        for (const handler of handlers as AnyHandler[]) handler(...args)
      }
      merged[key] = composeHandlers(callAll, libHandler as AnyHandler)
    }
  }

  return merged as Props & AnyProps
}
