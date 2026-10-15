import { createElement, useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLang, setLang, t } from '../i18n'
import { api } from '../protocol/api'
import type { RolloverStatus } from '../protocol/wire'
import { RolloverActions } from './RolloverActions'
import { canRollover } from './rollover'
import { HomeSessions } from './home/HomeSessions'
import { projectFixture } from './home/fixtures'

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useEffect: vi.fn(react.useEffect), useState: vi.fn(react.useState) }
})

const language = getLang()
afterEach(() => { setLang(language); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('rollover status reads', () => {
  const idle: RolloverStatus = { state: 'idle', handoff: '', startedAt: 0, error: '' }

  function mount(busy = false, initial: RolloverStatus | null = null) {
    vi.useFakeTimers()
    const document = Object.assign(new EventTarget(), { hidden: false })
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', globalThis)
    const status = vi.fn()
    const error = vi.fn()
    vi.mocked(useState).mockImplementationOnce(() => [initial, status])
      .mockImplementationOnce(() => [busy, vi.fn()])
      .mockImplementationOnce(() => ['', error])
    renderToStaticMarkup(createElement(RolloverActions, { id: 'session' }))
    // Run the component's real effect and cleanup without a browser. The
    // polling decision follows each reply, so it does not depend on rerenders.
    const cleanups = vi.mocked(useEffect).mock.calls.map(([effect]) => effect())
    const unmount = () => cleanups.forEach((cleanup) => { if (typeof cleanup === 'function') cleanup() })
    return { document, status, error, unmount }
  }

  it('reads idle once, refreshes on visibility, and ignores identical replies', async () => {
    const read = vi.spyOn(api, 'rolloverStatus').mockImplementation(async () => ({ ...idle }))
    const { document, status, unmount } = mount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(status).toHaveBeenCalledTimes(1)
    document.hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(read).toHaveBeenCalledTimes(1)
    document.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(status).toHaveBeenCalledTimes(1)
    unmount()
  })

  it.each(['done', 'failed', 'idle'] as const)('polls active states until %s, then stops', async (state) => {
    const read = vi.spyOn(api, 'rolloverStatus')
      .mockResolvedValueOnce({ ...idle, state: 'asking' })
      .mockResolvedValueOnce({ ...idle, state: 'waiting' })
      .mockResolvedValueOnce({ ...idle, state: 'waiting' })
      .mockResolvedValueOnce({ ...idle, state: 'ending' })
      .mockResolvedValue({ ...idle, state })
    const { status, unmount } = mount()
    await vi.advanceTimersByTimeAsync(1999)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(5)
    expect(status.mock.calls.map(([reply]) => reply.state)).toEqual(['asking', 'waiting', 'ending', state])
    unmount()
  })

  it('keeps polling while the action is busy even before its status becomes active', async () => {
    const read = vi.spyOn(api, 'rolloverStatus').mockResolvedValue(idle)
    const { status, unmount } = mount(true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(read).toHaveBeenCalledTimes(4)
    expect(status).toHaveBeenCalledTimes(1)
    unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('keeps tracking a known active status when the read after an action fails', async () => {
    const read = vi.spyOn(api, 'rolloverStatus').mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ...idle, state: 'done' })
    const { status, error, unmount } = mount(false, { ...idle, state: 'waiting' })
    await vi.advanceTimersByTimeAsync(0)
    expect(error).toHaveBeenLastCalledWith('offline')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(status).toHaveBeenLastCalledWith({ ...idle, state: 'done' })
    unmount()
  })

  it('pauses hidden polling, resumes on return and removes the timer and listener on unmount', async () => {
    const read = vi.spyOn(api, 'rolloverStatus').mockResolvedValue({ ...idle, state: 'waiting' })
    const { document, unmount } = mount()
    await vi.advanceTimersByTimeAsync(0)
    document.hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    document.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    unmount()
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('ignores an in-flight reply after unmount (failure: %s)', async (fail) => {
    let resolve!: (value: RolloverStatus) => void
    let reject!: (error: Error) => void
    const read = vi.spyOn(api, 'rolloverStatus').mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no }))
    const { document, status, error, unmount } = mount()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(read).toHaveBeenCalledTimes(1)
    unmount()
    if (fail) reject(new Error('closed'))
    else resolve({ ...idle, state: 'waiting' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(status).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('offers only supported agents, including absolute launch commands', () => {
  expect(canRollover({ command: 'node', launchCommand: ['/bin/codex'] })).toBe(true)
  expect(canRollover({ command: 'claude', launchCommand: [] })).toBe(true)
  expect(canRollover({ command: 'bash', launchCommand: ['bash', 'codex'] })).toBe(false)
  expect(canRollover({ command: 'codex', launchCommand: ['vibepanel', 'home-worker', 'job'] })).toBe(false)
})

it.each(['zh', 'en'] as const)('renders both handoff actions and the long-session action in %s', (lang) => {
  setLang(lang)
  const html = renderToStaticMarkup(createElement(HomeSessions, { project: projectFixture, resources: null, resourceError: '', busy: false, onCreate: async () => true, onRetry: () => {} }))
  expect(html).toContain(t('rollover.end'))
  expect(html).toContain(t('rollover.resume'))
  const todo = renderToStaticMarkup(createElement(RolloverActions, { id: 's', onlyResume: true, reason: 'long' }))
  expect(todo).toContain(t('rollover.resume'))
  expect(todo).not.toContain(t('rollover.end'))
})

it('uses authenticated session routes under the base path with the contract body', async () => {
  const result = { handoff: '/handoff.md', newSessionId: 'next' }
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(result)))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev' }) })
  expect(await api.rolloverSession('session/id', true, 'long')).toEqual(result)
  await api.rolloverStatus('session/id')
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method ?? 'GET', init.body])).toEqual([
    ['/dev/api/sessions/session%2Fid/rollover', 'POST', '{"reason":"long","resume":true}'],
    ['/dev/api/sessions/session%2Fid/rollover', 'GET', undefined],
  ])
})
