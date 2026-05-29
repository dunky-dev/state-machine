/**
 * Substrate-agnostic positioning vocabulary.
 *
 * Every floating component (tooltip, dropdown, popover, …) consumes
 * `Placement` + `PositioningOptions` the same way, and the `Side`
 * resolver math doesn't change across components. Pure data — no
 * React, no DOM, no Pixi.
 */

export type Placement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"
  | "right"
  | "right-start"
  | "right-end";

/** The base side a placement resolves to (drops the -start/-end suffix). */
export type Side = "top" | "bottom" | "left" | "right";

export interface PositioningOptions {
  placement: Placement;
  offset: { main: number; cross: number };
}

const sideMap: Record<Placement, Side> = {
  top: "top",
  "top-start": "top",
  "top-end": "top",
  bottom: "bottom",
  "bottom-start": "bottom",
  "bottom-end": "bottom",
  left: "left",
  "left-start": "left",
  "left-end": "left",
  right: "right",
  "right-start": "right",
  "right-end": "right",
};

/** Convert a logical placement to its base side (the `side` variant key). */
export function placementToSide(p: Placement): Side {
  return sideMap[p];
}
