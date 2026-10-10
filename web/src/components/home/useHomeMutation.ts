import { useRef, useState } from 'react'
import { HomeAPIError } from '../../protocol/home'
import { showToast } from '../toasts'

export function useHomeMutation(refresh: () => Promise<unknown> | void) {
  const locked = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (locked.current) return false
    locked.current = true
    setBusy(true)
    try {
      if (await action() === false) return false
      await refresh()
      return true
    } catch (error) {
      if (error instanceof HomeAPIError && error.status === 409) {
        showToast({ kind: 'error', key: 'home.conflict' })
        await refresh()
      } else showToast({ kind: 'error', key: 'home.actionFailed', detail: error instanceof Error ? error.message : String(error) })
      return false
    } finally { locked.current = false; setBusy(false) }
  }
  return { busy, run }
}
