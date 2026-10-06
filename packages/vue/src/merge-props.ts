import type { StyleValue } from 'vue'
import { composeHandlers, mergeProps as baseMergeProps } from '@dunky.dev/state-machine-utils'

type AnyProps = Record<string, unknown>
type AnyHandler = (...args: unknown[]) => unknown

// Vue's class shapes, spelled out: Vue exports its own ClassValue only from late 3.5 releases.
type ClassValue = false | null | undefined | string | Record<string, unknown> | ClassValue[]

/** `class` and `style` may come back as `[consumer, library]` — typed as Vue takes them. */
type MergedProps<Props> = Omit<Props, 'class' | 'style'> & {
  class?: ClassValue
  style?: StyleValue
} & AnyProps

// Vue's rule for a listener prop; the shared merge's rule agrees on every key Vue listens to.
const isListener = (key: string): boolean => /^on[^a-z]/.test(key)

// Vue's option modifiers in a listener name (`onClickCapture`, `onClickOnce`).
const OPTION_MODIFIERS = /(?:Once|Passive|Capture)+$/

// The shared veto on the library side alone: it runs unless the event was prevented.
const vetoable = (handler: AnyHandler): AnyHandler => composeHandlers(() => {}, handler)

/**
 * Merge consumer props with the component's normalized props, Vue-style: the
 * substrate-agnostic mergeProps (handlers chain consumer-first with the
 * `defaultPrevented` veto, library wins otherwise) plus Vue's own shapes:
 * - `class` / `style` set on both sides merge as `[consumer, library]` — Vue
 *   normalizes arrays of every class/style form, and the later entry wins a
 *   conflicting style key;
 * - an array of consumer handlers (what Vue's own mergeProps puts in `attrs`
 *   when a listener is bound twice) stays an array, the library handler last;
 * - a consumer listening with an option modifier (`onClickCapture`) still
 *   vetoes the library's plain listener for that event.
 *
 * Not Vue's `mergeProps`, which concatenates handlers with no veto.
 */
export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): MergedProps<Props> {
  const merged: AnyProps = baseMergeProps(consumer as AnyProps | undefined, library)
  if (!consumer) return merged as MergedProps<Props>
  const own = consumer as AnyProps

  for (const key in own) {
    const value = own[key]
    if (Array.isArray(value)) {
      // Kept an array, so Vue's invoker semantics hold — falsy entries skipped,
      // stopImmediatePropagation honored, each entry's error reported on its own.
      const libHandler = library[key]
      if (typeof libHandler === 'function' && isListener(key)) {
        merged[key] = [...value, vetoable(libHandler as AnyHandler)]
      }
    } else if (OPTION_MODIFIERS.test(key)) {
      // A separate listener that runs first — in the capture phase, or registered first — so
      // the library's plain listener can honor its veto; composing would move one's phase.
      const plain = key.replace(OPTION_MODIFIERS, '')
      const libHandler = library[plain]
      if (typeof libHandler === 'function' && own[plain] === undefined && isListener(plain)) {
        merged[plain] = vetoable(libHandler as AnyHandler)
      }
    }
  }

  // Both sides apply; a nullish library value adds nothing, so the consumer's stays.
  if (own.class != null) {
    merged.class = library.class == null ? own.class : [own.class, library.class]
  }
  if (own.style != null) {
    merged.style = library.style == null ? own.style : [own.style, library.style]
  }
  return merged as MergedProps<Props>
}
