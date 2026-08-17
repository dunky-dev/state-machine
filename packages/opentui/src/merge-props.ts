import { mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>

// OpenTUI style is a plain object (not array-mergeable like RN), so overlapping styles spread
// into one object with library winning on conflicts. No className in a terminal.
export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): Props & AnyProps {
  const merged: AnyProps = baseMergeProps(consumer as AnyProps | undefined, library)
  if (!consumer) return merged as Props & AnyProps

  const consumerStyle = (consumer as AnyProps).style
  const libraryStyle = library.style
  if (isStyleObject(consumerStyle) && isStyleObject(libraryStyle)) {
    merged.style = { ...consumerStyle, ...libraryStyle }
  }

  return merged as Props & AnyProps
}

function isStyleObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
