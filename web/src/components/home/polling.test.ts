import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchHomeVisibility } from './polling'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('visible home polling', () => {
  it('reads immediately and every ten seconds, pauses when hidden, and resumes on return', () => {
    vi.useFakeTimers()
    const document = Object.assign(new EventTarget(), { hidden: false })
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', globalThis)
    const refresh = vi.fn()
    const stop = watchHomeVisibility(refresh, true)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(9999)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    document.hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    document.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(3)
    stop()
    vi.advanceTimersByTime(20_000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('does not start a hidden page or poll a one-time catalogue', () => {
    vi.useFakeTimers()
    const document = Object.assign(new EventTarget(), { hidden: true })
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', globalThis)
    const refresh = vi.fn()
    const stop = watchHomeVisibility(refresh, false)
    expect(refresh).not.toHaveBeenCalled()
    document.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    stop()
  })
})
