import { mergeProps as baseMergeProps } from '@dunky.dev/shared-state-machine'

type AnyProps = Record<string, unknown>

// OpenTUI's `style` is a plain object (unlike RN, which also accepts an array),
// so overlapping styles merge into ONE object rather than wrapping into an array.
// Library wins on conflicting keys, matching the agnostic base's last-wins rule
// for plain attrs (the library's computed style is the authoritative one). There
// is no `className` in a terminal, so — like RN — we add no className branch.
export function mergeProps(consumer: AnyProps | undefined, library: AnyProps): AnyProps {
  const merged = baseMergeProps(consumer, library)
  if (!consumer) return merged

  const consumerStyle = consumer.style
  const libraryStyle = library.style
  if (isStyleObject(consumerStyle) && isStyleObject(libraryStyle)) {
    merged.style = { ...consumerStyle, ...libraryStyle }
  }

  return merged
}

function isStyleObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
