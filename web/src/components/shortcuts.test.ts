import { describe, expect, it } from 'vitest'

import { neighbour, panelShortcut } from './shortcuts'

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
})

describe('the panel keys', () => {
  it('are Ctrl+Shift with an arrow', () => {
    expect(panelShortcut(key('ArrowUp', { ctrlKey: true, shiftKey: true }))).toBe('prev')
    expect(panelShortcut(key('ArrowDown', { ctrlKey: true, shiftKey: true }))).toBe('next')
    expect(panelShortcut(key('ArrowLeft', { ctrlKey: true, shiftKey: true }))).toBe('leave')
  })

  it('leave every key a terminal needs to the terminal', () => {
    // Alt+arrow is a word jump in a shell; Ctrl+K kills to the end of the
    // line; Tab completes. The hands-on run tried the first two as panel keys.
    expect(panelShortcut(key('ArrowDown', { altKey: true }))).toBeNull()
    expect(panelShortcut(key('k', { ctrlKey: true }))).toBeNull()
    expect(panelShortcut(key('Tab'))).toBeNull()
    expect(panelShortcut(key('ArrowLeft', { ctrlKey: true }))).toBeNull()
    expect(panelShortcut(key('ArrowRight', { ctrlKey: true, shiftKey: true }))).toBeNull()
  })

  it('is not taken with another modifier as well', () => {
    expect(panelShortcut(key('ArrowUp', { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull()
    expect(panelShortcut(key('ArrowUp', { ctrlKey: true, shiftKey: true, metaKey: true }))).toBeNull()
  })

  it('acts on the press, not the release', () => {
    expect(panelShortcut({ ...key('ArrowUp', { ctrlKey: true, shiftKey: true }), type: 'keyup' })).toBeNull()
  })
})

describe('the next session', () => {
  it('follows the sidebar order and wraps', () => {
    expect(neighbour(['a', 'b', 'c'], 'a', 'next')).toBe('b')
    expect(neighbour(['a', 'b', 'c'], 'c', 'next')).toBe('a')
    expect(neighbour(['a', 'b', 'c'], 'a', 'prev')).toBe('c')
  })

  it('starts at the top when nothing is selected', () => {
    expect(neighbour(['a', 'b'], null, 'next')).toBe('a')
    expect(neighbour([], 'a', 'next')).toBeNull()
  })
})
