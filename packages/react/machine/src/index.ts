export { useMachine } from "./use-machine";
export { normalize, type Bindings } from "./normalize";
// Re-export for ergonomics — render layers usually use mergeProps alongside normalize.
export { mergeProps } from "@render-experiment/machine-core";
