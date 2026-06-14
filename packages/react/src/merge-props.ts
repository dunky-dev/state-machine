import { mergeProps as baseMergeProps } from '@chimba-ui/shared-state-machine'

type AnyProps = Record<string, unknown>

export function mergeProps(consumer: AnyProps | undefined, library: AnyProps): AnyProps {
  const merged = baseMergeProps(consumer, library)
  if (!consumer) return merged

  if (consumer.style != null && library.style != null) {
    merged.style = [consumer.style, library.style]
  }
  if (typeof consumer.className === 'string' && typeof library.className === 'string') {
    merged.className = `${consumer.className} ${library.className}`.trim()
  }

  return merged
}
