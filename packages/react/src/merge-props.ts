import { mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>

export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): Props & AnyProps {
  const merged: AnyProps = baseMergeProps(consumer as AnyProps | undefined, library)
  if (!consumer) return merged as Props & AnyProps
  const own = consumer as AnyProps

  if (own.style != null && library.style != null) {
    merged.style = [own.style, library.style]
  }
  if (typeof own.className === 'string' && typeof library.className === 'string') {
    merged.className = `${own.className} ${library.className}`.trim()
  }

  return merged as Props & AnyProps
}
