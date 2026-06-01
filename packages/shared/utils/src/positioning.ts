/**
 * Substrate-agnostic positioning vocabulary.
 *
 * Every floating component (tooltip, dropdown, popover, …) consumes
 * `Placement` + `PositioningOptions` the same way, and the `Side`
 * resolver math doesn't change across components. Pure data — no
 * React, no DOM.
 */

export type Placement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end'

/** The base side a placement resolves to (drops the -start/-end suffix). */
export type Side = 'top' | 'bottom' | 'left' | 'right'

export interface PositioningOptions {
  placement: Placement
  offset: { main: number; cross: number }
}

const sideMap: Record<Placement, Side> = {
  top: 'top',
  'top-start': 'top',
  'top-end': 'top',
  bottom: 'bottom',
  'bottom-start': 'bottom',
  'bottom-end': 'bottom',
  left: 'left',
  'left-start': 'left',
  'left-end': 'left',
  right: 'right',
  'right-start': 'right',
  'right-end': 'right',
}

/** Convert a logical placement to its base side (the `side` variant key). */
export function placementToSide(p: Placement): Side {
  return sideMap[p]
}

/**
 * Collision flip — pick the effective side given the preferred side, the
 * trigger's rect, the (possibly null) content rect, the viewport, and the
 * main-axis offset. Vertical/horizontal sides flip within their own axis
 * (top↔bottom, left↔right); we don't rotate 90°. Returns the preferred
 * side if no flip is needed or the content hasn't been measured yet.
 */
export interface ViewportSize {
  width: number
  height: number
}
export function pickSide(
  preferred: Side,
  triggerRect: { top: number; bottom: number; left: number; right: number },
  contentRect: { width: number; height: number } | null,
  viewport: ViewportSize,
  offset: number,
): Side {
  if (!contentRect) return preferred
  const ch = contentRect.height
  const cw = contentRect.width
  switch (preferred) {
    case 'bottom': {
      const fitsBottom = triggerRect.bottom + offset + ch <= viewport.height
      if (fitsBottom) return 'bottom'
      const fitsTop = triggerRect.top - offset - ch >= 0
      return fitsTop ? 'top' : 'bottom'
    }
    case 'top': {
      const fitsTop = triggerRect.top - offset - ch >= 0
      if (fitsTop) return 'top'
      const fitsBottom = triggerRect.bottom + offset + ch <= viewport.height
      return fitsBottom ? 'bottom' : 'top'
    }
    case 'right': {
      const fitsRight = triggerRect.right + offset + cw <= viewport.width
      if (fitsRight) return 'right'
      const fitsLeft = triggerRect.left - offset - cw >= 0
      return fitsLeft ? 'left' : 'right'
    }
    case 'left': {
      const fitsLeft = triggerRect.left - offset - cw >= 0
      if (fitsLeft) return 'left'
      const fitsRight = triggerRect.right + offset + cw <= viewport.width
      return fitsRight ? 'right' : 'left'
    }
  }
}
