type AnyProps = Record<string, unknown>
type AnyHandler = (...args: unknown[]) => unknown

const isEventHandlerKey = (key: string): boolean =>
  key.length > 2 && key.startsWith('on') && key[2] === key[2]!.toUpperCase()

const isFn = (v: unknown): v is AnyHandler => typeof v === 'function'

function compose(consumer: AnyHandler, library: AnyHandler): AnyHandler {
  return (...args) => {
    consumer(...args)
    // Respect consumer's defaultPrevented — if the first arg looks like
    // an event whose default was prevented, the library handler is
    // skipped. This matches Radix/Ark conventions.
    const event = args[0] as { defaultPrevented?: boolean } | undefined
    if (event && typeof event === 'object' && event.defaultPrevented) return
    return library(...args)
  }
}

// Generic over the consumer's props so framework prop types (interfaces
// without an index signature) pass in and come back out cast-free. The return
// is the Object.assign-style intersection: assignable to the consumer's props
// (the JSX spread needs no cast) while the library's bindings stay reachable.
export function mergeProps<Props extends object = AnyProps>(
  consumer: Props | undefined,
  library: AnyProps,
): Props & AnyProps {
  if (!consumer) return library as Props & AnyProps
  const out: AnyProps = { ...(consumer as AnyProps) }

  for (const [key, libValue] of Object.entries(library)) {
    const consumerValue = (consumer as AnyProps)[key]

    if (isEventHandlerKey(key) && isFn(consumerValue) && isFn(libValue)) {
      out[key] = compose(consumerValue, libValue)
      continue
    }

    // Default: library wins.
    out[key] = libValue
  }

  return out as Props & AnyProps
}
