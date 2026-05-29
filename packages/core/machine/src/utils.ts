/**
 * Compose two prop bags so consumer-passed handlers and library-supplied
 * handlers both fire.
 *
 * Rules:
 *   - For keys starting with `on` followed by an uppercase letter (event
 *     handlers in React + RN convention), if BOTH sides have a function,
 *     return a composed function that calls the consumer's first, then
 *     the library's. If the consumer's handler calls `event.preventDefault()`
 *     or `event.defaultPrevented` becomes true, the library's handler is
 *     skipped (consumer-cancel semantics).
 *
 *   - For `style`, return an array `[consumer.style, library.style]` so
 *     both apply. React + RN both accept array styles.
 *
 *   - For `className`, concatenate with a space (web-only; RN doesn't use
 *     it but won't error).
 *
 *   - Every other key: last-wins, with `library` taking precedence over
 *     `consumer` (so library-controlled attrs like aria-* and id can't
 *     be silently overridden).
 *
 * Use:
 *   const merged = mergeProps(consumerProps, machineProps);
 *   <Element {...merged} />
 *
 * Order: consumer first, library second. Library wins on non-handler
 * conflicts. Handlers compose.
 */

type AnyProps = Record<string, unknown>;

const isEventHandlerKey = (key: string): boolean =>
  key.length > 2 && key.startsWith("on") && key[2] === key[2]!.toUpperCase();

const isFn = (v: unknown): v is (...args: unknown[]) => unknown =>
  typeof v === "function";

function composeHandlers(
  consumer: (...args: unknown[]) => unknown,
  library: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  return (...args) => {
    consumer(...args);
    // Respect consumer's defaultPrevented — if the first arg looks like
    // an event whose default was prevented, the library handler is
    // skipped. This matches Radix/Ark conventions.
    const event = args[0] as { defaultPrevented?: boolean } | undefined;
    if (event && typeof event === "object" && event.defaultPrevented) return;
    return library(...args);
  };
}

export function mergeProps(
  consumer: AnyProps | undefined,
  library: AnyProps,
): AnyProps {
  if (!consumer) return library;
  const out: AnyProps = { ...consumer };

  for (const [key, libValue] of Object.entries(library)) {
    const consumerValue = consumer[key];

    if (isEventHandlerKey(key) && isFn(consumerValue) && isFn(libValue)) {
      out[key] = composeHandlers(consumerValue, libValue);
      continue;
    }

    if (key === "style" && consumerValue != null) {
      // React accepts array-of-styles for the style prop; RN accepts it too.
      out[key] = [consumerValue, libValue];
      continue;
    }

    if (key === "className" && typeof consumerValue === "string" && typeof libValue === "string") {
      out[key] = `${consumerValue} ${libValue}`.trim();
      continue;
    }

    // Default: library wins.
    out[key] = libValue;
  }

  return out;
}
