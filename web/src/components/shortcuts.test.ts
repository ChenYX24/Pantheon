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

describe('the panel keys in a text field', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}, classes: string[] = []) => ({
    tagName,
    classList: { contains: (c: string) => classes.includes(c) },
    ...extra,
  })
  const leave = (target: unknown) =>
    panelShortcut({ ...key('ArrowLeft', { ctrlKey: true, shiftKey: true }), target })

  it("are the field's own: select by word or paragraph", () => {
    expect(leave(el('TEXTAREA'))).toBeNull()
    expect(leave(el('INPUT', { type: 'text' }))).toBeNull()
    expect(leave(el('INPUT', { type: 'search' }))).toBeNull()
    expect(leave(el('DIV', { isContentEditable: true }))).toBeNull()
  })

  it("are the panel's in a terminal, whose focus sits in a textarea", () => {
    expect(leave(el('TEXTAREA', {}, ['xterm-helper-textarea']))).toBe('leave')
  })

  it("are the panel's on a button or a checkbox", () => {
    expect(leave(el('BUTTON'))).toBe('leave')
    expect(leave(el('INPUT', { type: 'checkbox' }))).toBe('leave')
    expect(leave(null)).toBe('leave')
  })
})
