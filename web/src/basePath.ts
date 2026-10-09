/** The server declares the mount; URL text and location alone are not trusted configuration. */
export function basePath(): string {
  const value = typeof document === 'undefined' ? '' : document.querySelector('meta[name="vibepanel-base"]')?.getAttribute('content') ?? ''
  return /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value) ? value : ''
}

export function appURL(path: `/${string}`): `/${string}`
export function appURL(path: string): string
export function appURL(path: string): string {
  const base = basePath()
  if (!base || !path.startsWith('/') || path.startsWith('//') || path === base || path.startsWith(base + '/') || path.startsWith(base + '?')) return path
  return base + path
}

export function appFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(appURL(path), init)
}

// Storage belongs to an instance too: a development tab must not change the
// live panel's language, layout or terminal-client identity on the same origin.
function storageKey(key: string): string {
  const base = basePath()
  return base ? `vibepanel:${base}:${key}` : key
}
function scopedStorage(kind: 'localStorage' | 'sessionStorage') {
  return {
    getItem: (key: string) => globalThis[kind].getItem(storageKey(key)),
    setItem: (key: string, value: string) => globalThis[kind].setItem(storageKey(key), value),
    removeItem: (key: string) => globalThis[kind].removeItem(storageKey(key)),
  }
}
export const appStorage = scopedStorage('localStorage')
export const appSessionStorage = scopedStorage('sessionStorage')
