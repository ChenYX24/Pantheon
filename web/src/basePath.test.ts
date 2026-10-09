import { afterEach, describe, expect, it, vi } from 'vitest'
import { appFetch, appSessionStorage, appStorage, appURL, basePath } from './basePath'

afterEach(() => vi.unstubAllGlobals())
function mount(value: string) {
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => value }) })
}
describe('co-hosted development instance', () => {
  it('mounts the home route and both kinds of deep link under the same base', async () => {
    mount('/dev/panel')
    vi.resetModules()
    const { HOME_PATH, routeFor } = await import('./routes')
    const { projectLink, todoLink } = await import('./components/home/helpers')
    expect(HOME_PATH).toBe('/dev/panel/home')
    expect(routeFor('/dev/panel/home/')).toEqual({ kind: 'home' })
    expect(routeFor('/home')).toEqual({ kind: 'panel' })
    expect(projectLink({ projectId: 'pantheon', taskId: 'A2' })).toBe('/dev/panel/home?project=pantheon&task=A2')
    expect(todoLink({ id: '1', kind: 'session_waiting', projectId: 'pantheon', title: '', detail: '', at: '', link: { projectId: 'pantheon', taskId: '', reportFile: '', sessionId: 'vp_123' } })).toBe('/dev/panel/?session=vp_123')
  })

  it('keeps the original root behavior and rejects unsafe mount metadata', () => {
    expect(appURL('/api/state')).toBe('/api/state')
    for (const invalid of ['/', '//host', '/dev/', '/..', '/dev?x']) {
      mount(invalid)
      expect(basePath()).toBe('')
    }
  })
  it('scopes local requests once, keeping external and encoded URLs unchanged', async () => {
    mount('/dev')
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    await appFetch('/api/state')
    expect(fetch).toHaveBeenCalledWith('/dev/api/state', undefined)
    expect(appURL('/dev/api/state')).toBe('/dev/api/state')
    expect(appURL('/api/file?path=a%2Fb')).toBe('/dev/api/file?path=a%2Fb')
    expect(appURL('https://example.com/')).toBe('https://example.com/')
    expect(appURL('//example.com/')).toBe('//example.com/')
    expect(appURL('/development')).toBe('/dev/development')
  })
  it('leaves live preferences and client identities untouched', () => {
    mount('/dev')
    const values = new Map([['theme', 'live']])
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    expect(appStorage.getItem('theme')).toBeNull()
    appStorage.setItem('theme', 'dev')
    appSessionStorage.setItem('client', 'dev-client')
    expect(values.get('theme')).toBe('live')
    expect(values.get('vibepanel:/dev:client')).toBe('dev-client')
    appStorage.removeItem('theme')
    expect(values.get('theme')).toBe('live')
  })
})
