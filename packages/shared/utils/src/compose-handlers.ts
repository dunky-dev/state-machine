// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

const composedCache = new WeakMap<AnyFn, WeakMap<AnyFn, AnyFn>>()

export function composeHandlers(
  handlers: Record<string, unknown>,
  props: Record<string, unknown>,
): void {
  for (const key in handlers) {
    const internal = handlers[key] as AnyFn
    const external = props[key]

    if (typeof external === 'function') {
      let innerMap = composedCache.get(internal)
      if (!innerMap) {
        innerMap = new WeakMap()
        composedCache.set(internal, innerMap)
      }
      let composed = innerMap.get(external as AnyFn)
      if (!composed) {
        composed = (...args: unknown[]) => {
          const internalResult = internal(...args)
          const externalResult = (external as AnyFn)(...args)
          return externalResult ?? internalResult
        }
        innerMap.set(external as AnyFn, composed)
      }
      props[key] = composed
    } else {
      props[key] = handlers[key]
    }
  }
}
