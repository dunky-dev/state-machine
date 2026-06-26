import { mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>

/**
 * Merge consumer props with the component's (normalized) props the Vue way.
 *
 * Handlers are chained consumer-first with the `defaultPrevented` veto (the
 * shared base does this). On top of that, the two Vue-specific class/style
 * conventions:
 *
 * - `class` is concatenated with a single space when both sides are strings
 *   (Vue's `class` also accepts arrays/objects; those fall through to the base's
 *   "library wins", since there's no general string concat for them).
 * - `style` is merged into a `[consumerStyle, libraryStyle]` array — Vue's array
 *   style binding, where the later entry wins on conflicting keys.
 *
 * Everything else: library wins (the component owns its semantics — `id`, `role`,
 * `aria-*`).
 */
export function mergeProps(consumer: AnyProps | undefined, library: AnyProps): AnyProps {
  const merged = baseMergeProps(consumer, library)
  if (!consumer) return merged

  if (consumer.style != null && library.style != null) {
    merged.style = [consumer.style, library.style]
  }
  if (typeof consumer.class === 'string' && typeof library.class === 'string') {
    merged.class = `${consumer.class} ${library.class}`.trim()
  }

  return merged
}
