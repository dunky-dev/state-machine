type AnyHandler = (...args: unknown[]) => unknown

/**
 * Chain a consumer handler before a library handler: the consumer runs first,
 * and the library handler is skipped when the consumer prevented default — if
 * the first argument looks like an event whose `defaultPrevented` is set, the
 * chain stops there. This matches Radix/Ark conventions and is the exact
 * composition `mergeProps` applies to overlapping `on*` props; exported for
 * consumers that need to compose a single handler pair outside a prop merge.
 */
export function composeHandlers(consumer: AnyHandler, library: AnyHandler): AnyHandler {
  return (...args) => {
    consumer(...args)
    const event = args[0] as { defaultPrevented?: boolean } | undefined
    if (event && typeof event === 'object' && event.defaultPrevented) return
    return library(...args)
  }
}
