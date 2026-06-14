/**
 * createStore — a tiny signal-backed store for cross-instance singletons.
 * Base get/set/subscribe always present; an optional builder adds named domain
 * methods (no facade boilerplate). Reads compose with the engine's reactivity.
 */
import { createStore } from '../src'
import { describe, expect, it, vi } from 'vitest'

describe('createStore', () => {
  it('base get/set/subscribe; set shallow-merges', () => {
    const store = createStore({ a: 1, b: 2 })
    expect(store.get()).toEqual({ a: 1, b: 2 })
    store.set({ a: 9 }) // merge, not replace
    expect(store.get()).toEqual({ a: 9, b: 2 })
    store.set(s => ({ b: s.b + 1 })) // updater form
    expect(store.get()).toEqual({ a: 9, b: 3 })
  })

  it('subscribe fires on change, not on subscribe; unsub stops it', () => {
    const store = createStore({ n: 0 })
    const fn = vi.fn()
    const off = store.subscribe(fn)
    expect(fn).not.toHaveBeenCalled()
    store.set({ n: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    store.set({ n: 2 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('builder adds named methods alongside the base, with store access', () => {
    const store = createStore({ openId: null as string | null }, s => ({
      setOpen: (id: string | null) => s.set({ openId: id }),
      isOpen: (id: string) => s.get().openId === id,
    }))
    // base still there
    expect(store.get().openId).toBe(null)
    // domain methods
    store.setOpen('x')
    expect(store.get().openId).toBe('x')
    expect(store.isOpen('x')).toBe(true)
    expect(store.isOpen('y')).toBe(false)
  })

  it('no-op set (same shallow values) does NOT notify (Object.is dedup)', () => {
    // set shallow-equal-dedups: writing the same value is a no-op, no wake.
    const store = createStore({ n: 5 })
    const fn = vi.fn()
    store.subscribe(fn)
    store.set({ n: 5 }) // same value
    expect(fn).not.toHaveBeenCalled()
    store.set({ n: 6 }) // real change
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
