import { mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>

/**
 * Merge consumer props with the component's normalized props, Solid-style:
 * the substrate-agnostic mergeProps (handlers compose, library wins) plus
 * Solid's `class` concat and single-object `style` merge (library wins on
 * conflicting keys; string styles fall through to library-wins).
 */
export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): Props & AnyProps {
  const merged: AnyProps = baseMergeProps(consumer as AnyProps | undefined, library)
  if (!consumer) return merged as Props & AnyProps
  const own = consumer as AnyProps

  if (typeof own.class === 'string' && typeof library.class === 'string') {
    merged.class = `${own.class} ${library.class}`.trim()
  }
  if (isStyleObject(own.style) && isStyleObject(library.style)) {
    merged.style = { ...own.style, ...library.style }
  }

  return merged as Props & AnyProps
}

function isStyleObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
