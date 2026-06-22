// =============================================================================
// @dunky.dev/opentui-state-machine
//
// The OpenTUI (terminal) binding TARGET: the substrate-specific translation of
// the agnostic binding vocabulary into OpenTUI renderable props. Pure functions
// over plain objects — `normalize` (logical bindings → OpenTUI props) and
// `mergeProps` (consumer + library prop merge).
//
// This package is deliberately FRAMEWORK-AGNOSTIC. OpenTUI is a renderer with
// multiple reactive bindings (@opentui/react, @opentui/solid, …); the prop
// translation is identical across all of them, so it lives here, free of any
// framework. The lifecycle binding — turning the engine's connector into a live
// component — is the framework's concern, NOT OpenTUI's:
//
//   • OpenTUI + React → pair this `normalize` with `useMachine` /`useSelector`
//     from `@dunky.dev/react-state-machine`.
//   • OpenTUI + Solid → pair this `normalize` with a Solid binding package
//     (the engine's `connector` exposes a framework-neutral snapshot/subscribe
//     contract, so a signals-based adapter is a thin wrapper — same as React's).
//
// Keeping this package free of `react`/`@opentui/*` is what lets a single
// translator serve every OpenTUI framework binding.
// =============================================================================

export { normalize, type Bindings } from './normalize'
export { mergeProps } from './merge-props'
