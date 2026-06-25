import { mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>

/**
 * Merge consumer props with the component's normalized props, Solid-style.
 *
 * Layers Solid's DOM conventions on the substrate-agnostic mergeProps (handler
 * compose with the `defaultPrevented` veto; everything else library-wins):
 *
 * - `class` is concatenated with a space (Solid uses `class`, not React's
 *   `className`).
 * - `style` is merged into ONE object, library winning on conflicting keys.
 *   Solid's `style` prop is a plain object (or string), NOT React's array form —
 *   so styles merge rather than wrap. (String styles fall through to
 *   library-wins; mixing a string and an object on the same element is a consumer
 *   error Solid itself wouldn't merge either.)
 */
export function mergeProps(consumer: AnyProps | undefined, library: AnyProps): AnyProps {
  const merged = baseMergeProps(consumer, library)
  if (!consumer) return merged

  if (typeof consumer.class === 'string' && typeof library.class === 'string') {
    merged.class = `${consumer.class} ${library.class}`.trim()
  }
  if (isStyleObject(consumer.style) && isStyleObject(library.style)) {
    merged.style = { ...consumer.style, ...library.style }
  }

  return merged
}

function isStyleObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
