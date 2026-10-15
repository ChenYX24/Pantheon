import { afterEach, describe, expect, it, vi } from 'vitest'

import { DISCONNECT_GRACE_MS, isDisconnected } from './Disconnected'

/**
 * When the panel says it has lost its connection.
 *
 * Before the strip, a disconnect was a 6px dot going hollow and nothing else:
 * the session states, the terminal and the compose box all went on looking
 * live. Too eager is its own failure -- a strip that flashes on every laptop
 * wake is a strip people learn to ignore -- so the grace is pinned both ways.
 */
describe('the disconnect grace', () => {
  it('is not disconnected while open', () => {
    expect(isDisconnected(null, Date.now())).toBe(false)
  })

  it('waits out the grace before saying so', () => {
    const t0 = 1_000_000
    expect(isDisconnected(t0, t0)).toBe(false)
    expect(isDisconnected(t0, t0 + DISCONNECT_GRACE_MS - 1)).toBe(false)
    expect(isDisconnected(t0, t0 + DISCONNECT_GRACE_MS)).toBe(true)
  })

  it('is seconds, not milliseconds or minutes', () => {
    expect(DISCONNECT_GRACE_MS).toBeGreaterThanOrEqual(1000)
    expect(DISCONNECT_GRACE_MS).toBeLessThanOrEqual(5000)
  })
})

describe('a request that never reached the panel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says so in the panel language rather than the browser\'s words', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    const { api, NetworkError } = await import('../protocol/api')
    const err = await api.health().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect((err as Error).message).not.toMatch(/fetch/i)
  })
})
