import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeAPIError, homeApi } from './home'

afterEach(() => vi.unstubAllGlobals())

function mockAPI(data: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(data), { status }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev' }) })
  return fetch
}

describe('the Stage A HTTP contract', () => {
  it('uses the mount for every read, including the existing executor catalogue', async () => {
    const fetch = mockAPI({})
    const signal = new AbortController().signal
    await homeApi.index(false, signal)
    await homeApi.index(true)
    await homeApi.project('project name', signal)
    await homeApi.discussion('pantheon', signal)
    await homeApi.notifications(signal)
    await homeApi.executors(signal)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/dev/api/home', '/dev/api/home?all=1', '/dev/api/home/projects/project%20name',
      '/dev/api/home/projects/pantheon/discussion', '/dev/api/home/notifications', '/dev/api/workflow/executors',
    ])
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', signal })
    expect(fetch.mock.calls.every(([, init]) => init.body === undefined)).toBe(true)
  })

  it('sends only contract fields and preserves task revisions', async () => {
    const result = { id: 'A2', rev: 'new-revision' }
    const fetch = mockAPI(result)
    const task = { title: 'Review', stage: 'A', primary: 'codex/model', dependsOn: ['A1'] }
    expect(await homeApi.createTask('pantheon', task)).toEqual(result)
    await homeApi.patchTask('pantheon', 'task/id', { rev: 'old-revision', status: 'done', blockedReason: '' })
    await homeApi.createSession('pantheon', { profileId: 'builtin:codex', name: 'Review' })
    await homeApi.sendMessage('pantheon', 'What next?', { harness: 'codex', model: 'model' })
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(init.body)])).toEqual([
      ['/dev/api/home/projects/pantheon/tasks', 'POST', task],
      ['/dev/api/home/projects/pantheon/tasks/task%2Fid', 'PATCH', { rev: 'old-revision', status: 'done', blockedReason: '' }],
      ['/dev/api/home/projects/pantheon/sessions', 'POST', { profileId: 'builtin:codex', name: 'Review' }],
      ['/dev/api/home/projects/pantheon/discussion', 'POST', { message: 'What next?', executor: { harness: 'codex', model: 'model' } }],
    ])
  })

  it('keeps the stale response available to the caller and never retries a write', async () => {
    const fetch = mockAPI({ error: 'stale', rev: 'latest-revision' }, 409)
    const pending = homeApi.patchTask('pantheon', 'A2', { rev: 'old', status: 'done' })
    await expect(pending).rejects.toBeInstanceOf(HomeAPIError)
    await expect(pending).rejects.toMatchObject({ status: 409, rev: 'latest-revision' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps unavailable distinct from an empty project list', async () => {
    mockAPI({ available: false, reason: 'Harness missing' })
    expect(await homeApi.index()).toEqual({ available: false, reason: 'Harness missing' })
  })

  it('reports an unreadable response instead of drawing an empty home', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>proxy error</html>', { status: 502 })))
    await expect(homeApi.index()).rejects.toMatchObject({ status: 502, message: 'HTTP 502' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON', { status: 200 })))
    await expect(homeApi.index()).rejects.toThrow()
  })

  it('does not require a response body from sending a discussion message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    expect(await homeApi.sendMessage('pantheon', 'Hello', { harness: 'claude', model: 'model' })).toBeNull()
  })
})
