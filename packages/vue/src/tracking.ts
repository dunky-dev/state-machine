import { customRef, ReactiveEffect } from 'vue'

// Vue 3.4's ReactiveEffect also takes a trigger, which it calls when the effect writes what it
// read; 3.5+ takes the function alone and ignores the rest.
type EffectConstructor = new <T>(fn: () => T, trigger: () => void) => ReactiveEffect<T>

/**
 * Runs `fn` so that whatever is tracking right now — a watchEffect, a computed, a render —
 * doesn't collect its reads. Vue has no public untrack(): a throwaway ReactiveEffect takes the
 * reads and is stopped at once.
 */
export function untracked<T>(fn: () => T): T {
  const effect = new (ReactiveEffect as unknown as EffectConstructor)(fn, () => {})
  try {
    return effect.run()
  } finally {
    effect.stop()
  }
}

/**
 * A dependency the bridge can track and trigger without a read: `triggerRef` reads its ref in
 * Vue 3.4 dev builds, and a trigger fired inside a tracked send() would hand that read to the
 * sender as a dependency.
 */
export function createTrigger(): { track: () => void; trigger: () => void } {
  let trigger!: () => void
  const signal = customRef<void>((track, notify) => {
    trigger = notify
    return { get: track, set: () => {} }
  })
  return { track: () => signal.value, trigger }
}
