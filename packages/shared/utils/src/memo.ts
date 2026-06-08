const MEMO: unique symbol = Symbol('memo')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

interface CacheNode {
  get(key: unknown): CacheNode | undefined
  set(key: unknown, value: CacheNode): void
  [MEMO]?: unknown
}

export function memo<T extends AnyFn>(fn: T): T {
  const cache: WeakMap<object, CacheNode> = new WeakMap()
  const intern = new Map<unknown, object>()

  return ((...args: Parameters<T>): ReturnType<T> => {
    let node: CacheNode = cache as unknown as CacheNode
    for (const arg of args) {
      let key: unknown = arg
      if (arg === null || (typeof arg !== 'object' && typeof arg !== 'function')) {
        let token = intern.get(arg)
        if (!token) {
          token = {}
          intern.set(arg, token)
        }
        key = token
      }
      let next = node.get(key)
      if (!next) {
        next = new WeakMap() as unknown as CacheNode
        node.set(key, next)
      }
      node = next
    }
    if (MEMO in node) {
      return node[MEMO] as ReturnType<T>
    }
    const result = fn(...args)
    node[MEMO] = result
    return result
  }) as T
}
