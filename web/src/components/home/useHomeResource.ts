import { useCallback, useEffect, useRef, useState } from 'react'
import { watchHomeVisibility } from './polling'

export function useHomeResource<T>(load: (signal: AbortSignal) => Promise<T>, poll = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const pending = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    try {
      const next = await load(controller.signal)
      if (controller.signal.aborted) return null
      setData(next)
      setError('')
      return next
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      if (pending.current === controller) {
        pending.current = null
        if (!controller.signal.aborted) setLoading(false)
      }
    }
  }, [load])

  useEffect(() => {
    const stop = watchHomeVisibility(() => { if (!pending.current) void refresh() }, poll)
    return () => {
      stop()
      // A closed sheet or a changed project must not receive the old read.
      pending.current?.abort()
      pending.current = null
    }
  }, [refresh, poll])

  return { data, error, loading, refresh }
}
