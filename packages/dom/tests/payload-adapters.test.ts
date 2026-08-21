/**
 * The DOM payload adapters — pure-logic tests (no DOM runtime needed).
 *
 * Each adapter reads a native DOM event into the neutral payload shape the
 * component vocabulary speaks (`ChangePayload`/`WheelPayload`/`ScrollPayload`).
 * The targets' own tests cover the wiring (that normalize() wraps a handler
 * with its adapter); the payload construction itself is pinned once, here.
 */
import { describe, expect, it } from 'vitest'
import { PAYLOAD_ADAPTERS, type AnyEvent } from '@dunky.dev/state-machine-dom'

const adapt = (key: string, e: AnyEvent): Record<string, unknown> =>
  PAYLOAD_ADAPTERS[key]!(e) as Record<string, unknown>

describe('dom payload adapters — onValueChange', () => {
  it('reads text-like inputs from target.value', () => {
    expect(adapt('onValueChange', { target: { value: 'hi', type: 'text' } })).toEqual({
      value: 'hi',
      defaultPrevented: undefined,
      preventDefault: undefined,
    })
  })

  it('reads checkbox/radio from target.checked (the boolean, not the value attr)', () => {
    expect(adapt('onValueChange', { target: { checked: true, type: 'checkbox' } })).toMatchObject({
      value: true,
    })
    expect(
      adapt('onValueChange', { target: { checked: false, value: 'on', type: 'radio' } }),
    ).toMatchObject({ value: false })
  })
})

describe('dom payload adapters — preventDefault', () => {
  it('binds payload.preventDefault to the event (a detached native method throws)', () => {
    // Fake event whose preventDefault asserts its `this`, like a native Event does.
    const makeEvent = (): AnyEvent => ({
      target: { value: 'x', type: 'text' },
      defaultPrevented: false,
      preventDefault(this: { defaultPrevented: boolean }) {
        this.defaultPrevented = true
      },
    })
    for (const key of ['onValueChange', 'onWheel']) {
      const event = makeEvent()
      ;(adapt(key, event).preventDefault as () => void)()
      expect(event.defaultPrevented).toBe(true)
    }
  })
})

describe('dom payload adapters — onWheel', () => {
  it('builds a WheelPayload with a neutral deltaUnit (deltaMode → enum)', () => {
    expect(adapt('onWheel', { deltaX: 1, deltaY: 2, deltaZ: 0, deltaMode: 1 })).toMatchObject({
      deltaX: 1,
      deltaY: 2,
      deltaZ: 0,
      deltaUnit: 'line',
    })
  })

  it('defaults deltaUnit to pixel when deltaMode is missing or out of range', () => {
    expect(adapt('onWheel', {})).toMatchObject({ deltaUnit: 'pixel' })
    expect(adapt('onWheel', { deltaMode: 7 })).toMatchObject({ deltaUnit: 'pixel' })
  })
})

describe('dom payload adapters — onScroll / onScrollEnd', () => {
  it('build a neutral ScrollPayload from currentTarget geometry', () => {
    const e: AnyEvent = {
      currentTarget: {
        scrollLeft: 5,
        scrollTop: 50,
        scrollWidth: 800,
        scrollHeight: 1200,
        clientWidth: 400,
        clientHeight: 600,
      },
    }
    for (const key of ['onScroll', 'onScrollEnd']) {
      expect(adapt(key, e)).toEqual({
        offsetX: 5,
        offsetY: 50,
        contentWidth: 800,
        contentHeight: 1200,
        viewportWidth: 400,
        viewportHeight: 600,
      })
    }
  })
})
