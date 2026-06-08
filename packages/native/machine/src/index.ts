// The lifecycle bridge, effects runner, and selector hook are React-renderer
// concerns — identical on RN (same React renderer) — so they're imported
// straight from machine-react rather than duplicated here. Only the
// substrate-specific translation (normalize → RN props, RN-aware mergeProps)
// lives in this package.
export {
  useMachine,
  useEffects,
  useSelector,
  type ComponentEffect,
  type ComponentEffects,
} from '@render-experiment/machine-react'

export { normalize, type Bindings } from './normalize'
// RN-aware mergeProps (handler compose + style array) layered on the
// substrate-agnostic mergeProps in @render-experiment/utils.
export { mergeProps } from './merge-props'
