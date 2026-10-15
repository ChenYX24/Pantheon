import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let values: Map<string, string>
let mount: string

beforeEach(() => {
  vi.resetModules()
  values = new Map()
  mount = ''
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => mount }) })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('browser-local typing preference', () => {
  it('defaults to Auto and rejects unknown stored values', async () => {
    const { LOCAL_ECHO_KEY, localEchoPreference } = await import('./localEchoPreference')
    expect(localEchoPreference()).toBe('auto')
    values.set(LOCAL_ECHO_KEY, 'unsafe')
    expect(localEchoPreference()).toBe('auto')
    values.set(LOCAL_ECHO_KEY, 'off')
    expect(localEchoPreference()).toBe('off')
  })

  it('scopes storage to the panel mount and applies changes to mounted terminals immediately', async () => {
    const { LOCAL_ECHO_KEY, localEchoPreference, setLocalEchoPreference, onLocalEchoPreference } = await import('./localEchoPreference')
    values.set(LOCAL_ECHO_KEY, 'off')
    mount = '/dev'
    expect(localEchoPreference()).toBe('auto')
    const seen: string[] = []
    const off = onLocalEchoPreference(() => seen.push(localEchoPreference()))
    setLocalEchoPreference('on')
    expect(seen).toEqual(['on'])
    expect(values.get(LOCAL_ECHO_KEY)).toBe('off')
    expect(values.get(`vibepanel:/dev:${LOCAL_ECHO_KEY}`)).toBe('on')
    values.set(`vibepanel:/dev:${LOCAL_ECHO_KEY}`, 'off')
    window.dispatchEvent(new Event('storage'))
    expect(seen).toEqual(['on', 'off'])
    off()
    setLocalEchoPreference('auto')
    expect(seen).toEqual(['on', 'off'])
  })

  it('still allows switching off when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const { localEchoPreference, setLocalEchoPreference } = await import('./localEchoPreference')
    expect(localEchoPreference()).toBe('auto')
    setLocalEchoPreference('off')
    expect(localEchoPreference()).toBe('off')
  })
})
