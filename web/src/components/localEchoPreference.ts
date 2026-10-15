import { appStorage } from '../basePath'
import type { LocalEchoMode } from './localEcho'

export const LOCAL_ECHO_KEY = 'vibepanel.localEcho'
const CHANGE_EVENT = 'vibepanel-local-echo'
let unsaved: LocalEchoMode | null = null

export function localEchoPreference(): LocalEchoMode {
  if (unsaved) return unsaved
  try {
    const stored = appStorage.getItem(LOCAL_ECHO_KEY)
    return stored === 'off' || stored === 'on' ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

export function setLocalEchoPreference(mode: LocalEchoMode): void {
  try {
    appStorage.setItem(LOCAL_ECHO_KEY, mode)
    unsaved = null
  } catch {
    // A blocked storage write must still let this tab turn prediction off.
    unsaved = mode
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function onLocalEchoPreference(fn: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, fn)
  window.addEventListener('storage', fn)
  return () => {
    window.removeEventListener(CHANGE_EVENT, fn)
    window.removeEventListener('storage', fn)
  }
}
