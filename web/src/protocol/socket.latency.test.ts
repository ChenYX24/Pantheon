import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelSocket } from './socket'
import type { ClientMessage } from './wire'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 1
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  sent: ClientMessage[] = []
  constructor() { FakeWebSocket.instances.push(this) }
  send(data: string) { this.sent.push(JSON.parse(data) as ClientMessage) }
  receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
  close() { this.readyState = 3; this.onclose?.() }
  get pings() { return this.sent.filter((msg) => msg.t === 'ping') }
}

const handlers = { onData: () => {}, onSize: () => {} }
let socket: PanelSocket
let visibility: EventTarget & { visibilityState: string }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  FakeWebSocket.instances = []
  visibility = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => null })
  vi.stubGlobal('document', visibility)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval, clearInterval }))
  vi.stubGlobal('location', { protocol: 'http:', host: 'panel.test' })
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000000' }))
  vi.stubGlobal('WebSocket', FakeWebSocket)
  socket = new PanelSocket()
})

afterEach(() => {
  socket.close()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function open(watching = false) {
  if (watching) socket.subscribe('s1', 80, 24, handlers)
  socket.connect()
  const ws = FakeWebSocket.instances.at(-1)!
  ws.onopen?.()
  return ws
}

function visible(value: boolean) {
  visibility.visibilityState = value ? 'visible' : 'hidden'
  visibility.dispatchEvent(new Event('visibilitychange'))
}

describe('application round trips', () => {
  it('measures the existing idle ping, ignoring unsolicited pongs', () => {
    const ws = open()
    ws.receive({ t: 'pong' })
    expect(socket.getLatency()).toBeNull()
    vi.advanceTimersByTime(25_000)
    expect(ws.pings).toHaveLength(1)
    vi.advanceTimersByTime(183)
    ws.receive({ t: 'pong' })
    expect(socket.getLatency()).toEqual({ rttMs: 183, jitterMs: 0, samples: 1 })
    ws.receive({ t: 'pong' })
    expect(socket.getLatency()?.samples).toBe(1)
  })

  it('shares fast probes between visible terminals and never overwrites an outstanding ping', () => {
    const ws = open(true)
    socket.subscribe('s2', 80, 24, handlers)
    expect(ws.pings).toHaveLength(1)
    vi.advanceTimersByTime(5_300)
    expect(ws.pings).toHaveLength(1)
    ws.receive({ t: 'pong' })
    expect(socket.getLatency()?.rttMs).toBe(5_300)
    vi.advanceTimersByTime(2_200)
    expect(ws.pings).toHaveLength(2)
  })

  it('averages only the last ten samples and reports their mean successive variation', () => {
    const ws = open(true)
    const samples = [900, 100, 200, 100, 200, 100, 200, 100, 200, 100, 200]
    for (const [i, sample] of samples.entries()) {
      vi.advanceTimersByTime(sample)
      ws.receive({ t: 'pong' })
      if (i < samples.length - 1) vi.advanceTimersByTime(2_500 - sample)
    }
    expect(socket.getLatency()).toEqual({ rttMs: 150, jitterMs: 100, samples: 10 })
  })

  it('stops fast probes when the last terminal is hidden or unsubscribed', () => {
    const ws = open(true)
    ws.receive({ t: 'pong' })
    socket.setHidden('s1', true)
    vi.advanceTimersByTime(5_000)
    expect(ws.pings).toHaveLength(1)
    socket.setHidden('s1', false)
    expect(ws.pings).toHaveLength(2)
    ws.receive({ t: 'pong' })
    socket.unsubscribe('s1')
    vi.advanceTimersByTime(5_000)
    expect(ws.pings).toHaveLength(2)
  })

  it('keeps the 25s heartbeat while the tab is hidden, without measuring browser suspension', () => {
    const ws = open(true)
    vi.advanceTimersByTime(100)
    visible(false)
    vi.advanceTimersByTime(5_000)
    visible(true)
    ws.receive({ t: 'pong' })
    expect(socket.getLatency()).toBeNull()
    visible(false)
    vi.advanceTimersByTime(19_900)
    expect(ws.pings).toHaveLength(2)
    ws.receive({ t: 'pong' })
    expect(socket.getLatency()).toBeNull()
    visible(true)
    expect(ws.pings).toHaveLength(3)
    vi.advanceTimersByTime(300)
    ws.receive({ t: 'pong' })
    expect(socket.getLatency()?.rttMs).toBe(300)
  })

  it('retains the 60s silence backstop even with a ping outstanding', () => {
    const ws = open(true)
    vi.advanceTimersByTime(74_999)
    expect(socket.status).toBe('open')
    vi.advanceTimersByTime(1)
    expect(socket.status).toBe('closed')
    expect(ws.readyState).toBe(3)
  })

  it('still treats any received frame as proof of liveness', () => {
    const ws = open(true)
    vi.advanceTimersByTime(50_000)
    ws.receive({ t: 'title', sessionId: 's1', text: 'alive' })
    vi.advanceTimersByTime(25_000)
    expect(socket.status).toBe('open')
  })

  it('publishes updates, clears them on disconnect, and starts a fresh window on reconnect', () => {
    const seen = vi.fn()
    const off = socket.onLatency(seen)
    const ws = open(true)
    vi.advanceTimersByTime(300)
    ws.receive({ t: 'pong' })
    expect(seen).toHaveBeenLastCalledWith({ rttMs: 300, jitterMs: 0, samples: 1 })
    ws.close()
    expect(seen).toHaveBeenLastCalledWith(null)
    expect(socket.getLatency()).toBeNull()
    vi.advanceTimersByTime(500)
    const next = FakeWebSocket.instances.at(-1)!
    next.onopen?.()
    vi.advanceTimersByTime(50)
    next.receive({ t: 'pong' })
    expect(socket.getLatency()).toEqual({ rttMs: 50, jitterMs: 0, samples: 1 })
    off()
    seen.mockClear()
    socket.close()
    visible(false)
    visible(true)
    vi.advanceTimersByTime(100_000)
    expect(seen).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
