import { createElement, useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeApi } from '../../protocol/home'
import { useHomeResource } from './useHomeResource'
import { usePanelHomeLinks } from './usePanelHomeLinks'

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useEffect: vi.fn(react.useEffect), useState: vi.fn(react.useState) }
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

function mount<T>(useRead: () => T) {
  vi.useFakeTimers()
  const document = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', globalThis)
  const data = vi.fn()
  const error = vi.fn()
  const loading = vi.fn()
  vi.mocked(useState).mockImplementationOnce(() => [null, data])
    .mockImplementationOnce(() => ['', error])
    .mockImplementationOnce(() => [true, loading])
  let result!: T
  function Probe() { result = useRead(); return null }
  renderToStaticMarkup(createElement(Probe))
  // Exercise the real effect, read callback and cleanup with controlled time;
  // state spies expose updates that would wake a mounted consumer.
  const unmount = vi.mocked(useEffect).mock.calls.at(-1)![0]() as () => void
  return { result, document, data, error, loading, unmount }
}

describe('home resource refreshes', () => {
  it('keeps equal background replies and loading quiet while preserving default polling', async () => {
    const load = vi.fn(async () => ({ projects: [{ id: 'p' }] }))
    const { data, loading, unmount } = mount(() => useHomeResource(load))
    await vi.advanceTimersByTimeAsync(0)
    expect(loading.mock.calls).toEqual([[true], [false]])
    loading.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledTimes(4)
    expect(data).toHaveBeenCalledTimes(1)
    expect(loading).not.toHaveBeenCalled()
    unmount()
  })

  it('publishes changed replies at a custom interval without a loading flash', async () => {
    const load = vi.fn().mockResolvedValueOnce({ log: 'first' }).mockResolvedValue({ log: 'next' })
    const { data, loading, unmount } = mount(() => useHomeResource(load, 3000))
    await vi.advanceTimersByTimeAsync(0)
    loading.mockClear()
    await vi.advanceTimersByTimeAsync(2999)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(data.mock.calls).toEqual([[{ log: 'first' }], [{ log: 'next' }]])
    expect(loading).not.toHaveBeenCalled()
    unmount()
  })

  it('keeps explicit refresh loading and its returned reply, even for equal data', async () => {
    const load = vi.fn(async () => ({ models: [] }))
    const { result, data, loading, unmount } = mount(() => useHomeResource(load, false))
    await vi.advanceTimersByTimeAsync(0)
    loading.mockClear()
    expect(await result.refresh()).toEqual({ models: [] })
    expect(loading.mock.calls).toEqual([[true], [false]])
    expect(data).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('reports errors, retains data and clears the error on an unchanged recovery', async () => {
    const load = vi.fn().mockResolvedValueOnce({ projects: [] })
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ projects: [] })
    const { data, error, loading, unmount } = mount(() => useHomeResource(load))
    await vi.advanceTimersByTimeAsync(0)
    loading.mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(error).toHaveBeenLastCalledWith('offline')
    expect(data).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(error).toHaveBeenLastCalledWith('')
    expect(data).toHaveBeenCalledTimes(1)
    expect(loading).not.toHaveBeenCalled()
    unmount()
  })

  it('aborts a superseded read and ignores its late result', async () => {
    let resolve!: (value: { id: string }) => void
    const load = vi.fn<(signal: AbortSignal) => Promise<{ id: string }>>()
      .mockReturnValueOnce(new Promise((yes) => { resolve = yes })).mockResolvedValue({ id: 'new' })
    const { result, data, loading, unmount } = mount(() => useHomeResource(load))
    const first = load.mock.calls[0][0]
    expect(await result.refresh()).toEqual({ id: 'new' })
    expect(first.aborted).toBe(true)
    resolve({ id: 'old' })
    await vi.advanceTimersByTimeAsync(0)
    expect(data.mock.calls).toEqual([[{ id: 'new' }]])
    expect(loading.mock.calls).toEqual([[true], [true], [false]])
    unmount()
  })

  it('aborts on unmount and stops timers, visibility reads and late state updates', async () => {
    let resolve!: (value: { id: string }) => void
    const load = vi.fn<(signal: AbortSignal) => Promise<{ id: string }>>()
      .mockReturnValue(new Promise((yes) => { resolve = yes }))
    const { document, data, error, loading, unmount } = mount(() => useHomeResource(load))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledTimes(1)
    unmount()
    expect(load.mock.calls[0][0].aborted).toBe(true)
    loading.mockClear()
    resolve({ id: 'closed' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(data).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(loading).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('loads terminal project links once and on visibility, without a ten-second poll', async () => {
  const read = vi.spyOn(homeApi, 'index').mockResolvedValue({ available: false, reason: 'not configured' })
  const { document, data, loading, unmount } = mount(usePanelHomeLinks)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(read).toHaveBeenCalledExactlyOnceWith(true, expect.any(AbortSignal))
  loading.mockClear()
  document.hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  expect(read).toHaveBeenCalledTimes(1)
  document.hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(read).toHaveBeenCalledTimes(2)
  expect(data).toHaveBeenCalledTimes(1)
  expect(loading).not.toHaveBeenCalled()
  unmount()
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(read).toHaveBeenCalledTimes(2)
})
