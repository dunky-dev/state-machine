// =============================================================================
// @dunky.dev/opentui-state-machine
//
// The OpenTUI (terminal) binding TARGET: the substrate-specific translation of
// the agnostic binding vocabulary into OpenTUI renderable props. Pure functions
// over plain objects — `normalize` (logical bindings → OpenTUI props) and
// `mergeProps` (consumer + library prop merge).
//
// This package is ONLY the translator. It has no framework dependency and no
// lifecycle hook — `normalize`/`mergeProps` are pure, so they work the same under
// any of OpenTUI's reactive bindings (@opentui/react, @opentui/solid, …). The
// lifecycle binding (turning the engine's connector into a live component) is the
// consuming app's concern: it brings its own framework hook and feeds the
// connector's snapshot through it, then spreads `normalize(bindings)` onto the
// OpenTUI elements. Deliberately free of `react`/`@opentui/*`.
// =============================================================================

export { normalize, type Bindings } from './normalize'
export { mergeProps } from './merge-props'
