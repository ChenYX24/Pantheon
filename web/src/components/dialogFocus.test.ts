import { describe, expect, it } from 'vitest'

import { escapeClosesThis, nextTabIndex, shouldRestoreFocus } from './dialogFocus'

describe('Tab inside a dialog', () => {
  it('wraps from the last element to the first, and back', () => {
    expect(nextTabIndex(4, 3, false)).toBe(0)
    expect(nextTabIndex(4, 0, true)).toBe(3)
  })
  it('leaves the steps in the middle to the browser', () => {
    expect(nextTabIndex(4, 1, false)).toBeNull()
    expect(nextTabIndex(4, 2, true)).toBeNull()
  })
  it('pulls a focus that is outside back in', () => {
    expect(nextTabIndex(4, -1, false)).toBe(0)
    expect(nextTabIndex(4, -1, true)).toBe(3)
  })
  it('wraps a single element onto itself', () => {
    expect(nextTabIndex(1, 0, false)).toBe(0)
    expect(nextTabIndex(1, 0, true)).toBe(0)
  })
  it('has nothing to say about an empty dialog', () => {
    expect(nextTabIndex(0, -1, false)).toBeNull()
  })
})

describe('giving the focus back', () => {
  it('does when it is lost', () => {
    expect(shouldRestoreFocus(null, true)).toBe(true)
    expect(shouldRestoreFocus({ isBody: true, insideDialog: false }, true)).toBe(true)
    expect(shouldRestoreFocus({ isBody: false, insideDialog: true }, true)).toBe(true)
  })
  it('does not when the person put it somewhere else', () => {
    expect(shouldRestoreFocus({ isBody: false, insideDialog: false }, true)).toBe(false)
  })
  it('does not when the opener is gone', () => {
    expect(shouldRestoreFocus(null, false)).toBe(false)
  })
})

describe('Escape with dialogs stacked', () => {
  const a = {}
  const b = {}
  const esc = { key: 'Escape', defaultPrevented: false }
  it('closes only the one on top', () => {
    expect(escapeClosesThis([a, b], b, esc)).toBe(true)
    expect(escapeClosesThis([a, b], a, esc)).toBe(false)
  })
  it('is not for a key somebody already used, or an input method', () => {
    expect(escapeClosesThis([a], a, { ...esc, defaultPrevented: true })).toBe(false)
    expect(escapeClosesThis([a], a, { ...esc, isComposing: true })).toBe(false)
    expect(escapeClosesThis([a], a, { ...esc, key: 'Enter' })).toBe(false)
  })
})
