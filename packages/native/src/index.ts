// The lifecycle bridge (which also runs the component effects) and the selector
// hook are React-renderer concerns — identical on RN (same React renderer) — so
// they're imported straight from machine-react rather than duplicated here. Only
// the substrate-specific translation (normalize → RN props, RN-aware mergeProps)
// lives in this package.
export {
  useMachine,
  useSelector,
  type ComponentEffect,
  type ComponentEffects,
} from '@dunky.dev/state-machine-react'

export { normalize, type Bindings } from './normalize'
// RN-aware mergeProps (handler compose + style array) layered on the
// substrate-agnostic mergeProps in @dunky.dev/state-machine-utils.
export { mergeProps } from './merge-props'
