/** True when applying `patch` would change at least one key (Object.is per key). */
export function shouldPatch<T extends object>(target: T, patch: Partial<T>): boolean {
  for (const key in patch) {
    if (!Object.is(target[key], patch[key])) return true
  }
  return false
}
