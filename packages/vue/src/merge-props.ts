import { mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>

export function mergeProps(consumer: AnyProps | undefined, library: AnyProps): AnyProps {
  const merged = baseMergeProps(consumer, library)
  if (!consumer) return merged

  // Vue's array style binding — later entry wins on conflicting keys.
  if (consumer.style != null && library.style != null) {
    merged.style = [consumer.style, library.style]
  }
  // Non-string class shapes (array/object) fall through to the base's library-wins.
  if (typeof consumer.class === 'string' && typeof library.class === 'string') {
    merged.class = `${consumer.class} ${library.class}`.trim()
  }

  return merged
}
