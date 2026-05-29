/**
 * Memoize a pure function on its argument identity.
 *
 *   const slow = (a, b) => expensiveJoin(a, b);
 *   const fast = memo(slow);
 *
 *   fast(x, y)  // computes, caches
 *   fast(x, y)  // returns cached result
 *   fast(x, z)  // computes for (x, z), keeps (x, y) cache
 *
 * Implementation: a chain of WeakMaps keyed on each argument. Primitives
 * (strings, numbers, booleans, null, undefined) get interned into stable
 * token objects so the same WeakMap chain works for them too.
 *
 * Cache lifetime: WeakMap entries are collected when the keys are
 * collected; primitive intern tokens survive forever (so memo is best
 * suited to bounded primitive domains).
 *
 * Borrowed from Miro's canvas-design-system/xwidget/utils.ts.
 */

const MEMO: unique symbol = Symbol("memo");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

interface CacheNode {
  get(key: unknown): CacheNode | undefined;
  set(key: unknown, value: CacheNode): void;
  [MEMO]?: unknown;
}

export function memo<T extends AnyFn>(fn: T): T {
  const cache: WeakMap<object, CacheNode> = new WeakMap();
  const intern = new Map<unknown, object>();

  return ((...args: Parameters<T>): ReturnType<T> => {
    let node: CacheNode = cache as unknown as CacheNode;
    for (const arg of args) {
      let key: unknown = arg;
      if (
        arg === null ||
        (typeof arg !== "object" && typeof arg !== "function")
      ) {
        let token = intern.get(arg);
        if (!token) {
          token = {};
          intern.set(arg, token);
        }
        key = token;
      }
      let next = node.get(key);
      if (!next) {
        next = new WeakMap() as unknown as CacheNode;
        node.set(key, next);
      }
      node = next;
    }
    if (MEMO in node) {
      return node[MEMO] as ReturnType<T>;
    }
    const result = fn(...args);
    node[MEMO] = result;
    return result;
  }) as T;
}
