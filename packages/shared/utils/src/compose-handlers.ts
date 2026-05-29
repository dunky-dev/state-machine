/**
 * Merge `handlers` into `props`, composing any overlapping `on*` keys.
 *
 *   const props = { onClick: consumer.onClick, className: "x" };
 *   composeHandlers({ onClick: library.onClick, onFocus: library.onFocus }, props);
 *   // props.onClick is now a function that calls library.onClick then
 *   // consumer.onClick, returning consumer's result preferentially.
 *   // props.onFocus is now library.onFocus.
 *
 * Semantics:
 *   - For each key in `handlers`: if `props[key]` is also a function,
 *     wrap them so both fire. The library handler runs first, then the
 *     consumer handler. The composed function returns `consumer ?? library`
 *     so consumers can intentionally return a value (e.g., a Promise) and
 *     have it surface.
 *   - Otherwise (no consumer handler), overwrite `props[key]` with the
 *     library handler.
 *   - Mutates `props` in place — call site is responsible for fresh
 *     objects if it needs immutability.
 *
 * Cache: composed wrappers are interned by (internal, external) identity
 * so stable handler pairs don't allocate new functions on every render.
 *
 * Borrowed from Miro's canvas-design-system/xwidget/utils.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const composedCache = new WeakMap<AnyFn, WeakMap<AnyFn, AnyFn>>();

export function composeHandlers(
  handlers: Record<string, unknown>,
  props: Record<string, unknown>,
): void {
  for (const key in handlers) {
    const internal = handlers[key] as AnyFn;
    const external = props[key];

    if (typeof external === "function") {
      let innerMap = composedCache.get(internal);
      if (!innerMap) {
        innerMap = new WeakMap();
        composedCache.set(internal, innerMap);
      }
      let composed = innerMap.get(external as AnyFn);
      if (!composed) {
        composed = (...args: unknown[]) => {
          const internalResult = internal(...args);
          const externalResult = (external as AnyFn)(...args);
          return externalResult ?? internalResult;
        };
        innerMap.set(external as AnyFn, composed);
      }
      props[key] = composed;
    } else {
      props[key] = handlers[key];
    }
  }
}
