import { mergeProps as baseMergeProps } from '@chimba-ui/utils'

type AnyProps = Record<string, unknown>

export function mergeProps(consumer: AnyProps | undefined, library: AnyProps): AnyProps {
  const merged = baseMergeProps(consumer, library)
  if (!consumer) return merged

  if (consumer.style != null && library.style != null) {
    merged.style = [consumer.style, library.style]
  }

  return merged
}
