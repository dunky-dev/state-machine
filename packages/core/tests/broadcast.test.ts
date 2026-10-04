/**
 * Broadcast — the payload-less one-to-all notify primitive under the machine's
 * subscriptions and the connector's wake. Pins the membership contract under
 * churn: what fires in the pass where the membership changed.
 */
import { makeBroadcast } from '../src/broadcast'
import { describe, expect, it } from 'vitest'

describe('broadcast — membership under churn', () => {
  it('notify wakes every listener; never on add', () => {
    const b = makeBroadcast()
    const calls: string[] = []
    b.add(() => calls.push('a'))
    b.add(() => calls.push('b'))
    expect(calls).toEqual([]) // add is silent
    b.notify()
    expect(calls).toEqual(['a', 'b'])
  })

  it('the remover detaches; removing twice is harmless', () => {
    const b = makeBroadcast()
    const calls: string[] = []
    const off = b.add(() => calls.push('a'))
    off()
    off()
    b.notify()
    expect(calls).toEqual([])
  })

  it('a listener removed mid-pass does not fire in that pass', () => {
    const b = makeBroadcast()
    const calls: string[] = []
    let offB = () => {}
    b.add(() => {
      calls.push('a')
      offB()
    })
    offB = b.add(() => calls.push('b'))
    b.notify()
    expect(calls).toEqual(['a'])
  })

  it('a listener added mid-pass waits for the next notify', () => {
    const b = makeBroadcast()
    const calls: string[] = []
    let added = false
    b.add(() => {
      calls.push('a')
      if (!added) {
        added = true
        b.add(() => calls.push('late'))
      }
    })
    b.notify()
    expect(calls).toEqual(['a']) // not this pass
    b.notify()
    expect(calls).toEqual(['a', 'a', 'late']) // next pass includes it
  })

  it('a nested notify does not resurrect a listener removed in the outer pass', () => {
    const b = makeBroadcast()
    const calls: string[] = []
    let offB = () => {}
    let nested = false
    b.add(() => {
      calls.push('a')
      if (!nested) {
        nested = true
        offB()
        b.notify() // rebuilds the snapshot and clears the dirty flag mid-pass
      }
    })
    offB = b.add(() => calls.push('b'))
    b.notify()
    expect(calls).toEqual(['a', 'a']) // b fired in neither pass
  })

  it('clear() drops everyone at once', () => {
    const b = makeBroadcast()
    const calls: string[] = []
    b.add(() => calls.push('a'))
    b.add(() => calls.push('b'))
    b.clear()
    b.notify()
    expect(calls).toEqual([])
  })
})
