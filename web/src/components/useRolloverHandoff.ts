import { useEffect, useRef } from 'react'
import type { AutoRollover } from '../protocol/wire'
import { dismissToast } from './toasts'
import { announceHandoff, handoffInputFocused, selectedHandoff } from './rolloverHandoff'

export function useRolloverHandoff(views: Record<string, AutoRollover>, selected: string | null, select: (id: string) => void) {
  const seen = useRef(new Set<string>())
  const notices = useRef(new Map<string, { newId: string; toast: number }>())
  useEffect(() => {
    for (const [oldId, notice] of notices.current) {
      if (views[oldId]?.state !== 'handed_off' || views[oldId]?.newSessionId !== notice.newId) {
        dismissToast(notice.toast)
        notices.current.delete(oldId)
      }
    }
    const pair = selectedHandoff(seen.current, views, selected)
    if (pair) {
      const toast = announceHandoff(pair, select, handoffInputFocused(document.activeElement))
      notices.current.set(pair.oldId, { newId: pair.newId, toast })
    }
  }, [views, selected, select])
}
