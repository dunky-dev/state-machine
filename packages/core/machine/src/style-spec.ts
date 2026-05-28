/**
 * Agnostic style spec — the shape components use to describe per-element
 * styling without committing to a renderer.
 *
 * Property naming rule:
 *   - Use CSS names where they map cleanly across renderers.
 *   - For the handful that don't (writing-mode logical inline/block),
 *     use physical-axis equivalents: `paddingX` / `paddingY`. Adapters
 *     expand these to substrate-native equivalents.
 *
 * Shape: flat base styles at the top level alongside variants /
 * compoundVariants / defaultVariants — same arrangement Stitches uses.
 *
 * Today this carries both functional (positioning, hit-test, visibility)
 * and cosmetic (color, padding, font) styles. The intent is to split
 * those layers eventually — cosmetic moves to a consumer-supplied theme,
 * functional stays in core. The merge boundary doesn't exist yet.
 */

export type StyleValue = string | number | boolean;

export interface Style {
  [prop: string]: StyleValue | StyleValue[];
}

// Flat spec — base style props live at the top level. Variants/etc. live
// alongside them under reserved keys. Loose index signature on purpose:
// the translator inspects each key and decides whether it's a style prop
// or a structural key, so a strict union here would over-constrain authors.
export type StyleSpec<TVariants extends Record<string, Record<string, Style>>> = {
  variants: TVariants;
  compoundVariants?: Array<
    {
      [K in keyof TVariants]?: keyof TVariants[K];
    } & { css: Style }
  >;
  defaultVariants?: { [K in keyof TVariants]?: keyof TVariants[K] };
  [prop: string]: unknown;
};
