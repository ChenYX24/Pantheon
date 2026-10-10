import { useSyncExternalStore } from 'react'

// A 2,000-row table shares one clock, including its hidden narrow-screen rows.
const listeners = new Set<() => void>()
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const snapshot = () => now
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) timer = setInterval(() => {
    if (document.hidden) return
    now = Date.now()
    for (const update of listeners) update()
  }, 10000)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { clearInterval(timer); timer = undefined }
  }
}
export function useHomeClock() { return useSyncExternalStore(subscribe, snapshot, snapshot) }
