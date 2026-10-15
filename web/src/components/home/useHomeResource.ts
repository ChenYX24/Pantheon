import { useCallback, useEffect, useRef, useState } from 'react'
import { watchHomeVisibility } from './polling'

export function useHomeResource<T>(load: (signal: AbortSignal) => Promise<T>, poll: boolean | number = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const pending = useRef<AbortController | null>(null)
  const snapshot = useRef<string | undefined>(undefined)

  const read = useCallback(async (background: boolean) => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    if (!background) setLoading(true)
    try {
      const next = await load(controller.signal)
      if (controller.signal.aborted) return null
      // The loaders return JSON. Retain the previous object when a background
      // read changes nothing, so its consumers do not rerender on every poll.
      const serialized = JSON.stringify(next)
      if (snapshot.current !== serialized) {
        snapshot.current = serialized
        setData(next)
      }
      setError('')
      return next
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      if (pending.current === controller) {
        pending.current = null
        if (!controller.signal.aborted && !background) setLoading(false)
      }
    }
  }, [load])
  const refresh = useCallback(() => read(false), [read])

  useEffect(() => {
    let initial = true
    const stop = watchHomeVisibility(() => {
      if (pending.current) return
      void read(!initial)
      initial = false
    }, poll)
    return () => {
      stop()
      // A closed sheet or a changed project must not receive the old read.
      pending.current?.abort()
      pending.current = null
    }
  }, [read, poll])

  return { data, error, loading, refresh }
}
