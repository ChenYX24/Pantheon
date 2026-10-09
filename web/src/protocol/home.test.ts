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
    await homeApi.discussion('pantheon', 'main', signal)
    await homeApi.notifications(signal)
    await homeApi.executors(signal)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/dev/api/home', '/dev/api/home?all=1', '/dev/api/home/projects/project%20name',
      '/dev/api/home/projects/pantheon/discussion?thread=main', '/dev/api/home/notifications', '/dev/api/workflow/executors',
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
      ['/dev/api/home/projects/pantheon/discussion', 'POST', { message: 'What next?', executor: { harness: 'codex', model: 'model' }, thread: 'main' }],
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

  it('returns the two persisted messages accepted for an asynchronous reply', async () => {
    const result = { user: { id: 'u1', status: 'done' }, assistant: { id: 'a1', status: 'pending' } }
    mockAPI(result, 202)
    expect(await homeApi.sendMessage('pantheon', 'Hello', { harness: 'claude', model: 'model' })).toEqual(result)
  })
})

describe('the Stage A.2 HTTP contract', () => {
  it('reads models, threads, fields, aggregate tasks and redacted notification settings', async () => {
    const fetch = mockAPI({})
    const signal = new AbortController().signal
    await homeApi.models(signal)
    await homeApi.threads('pantheon', signal)
    await homeApi.discussion('pantheon', 'thread & 1', signal)
    await homeApi.fields(signal)
    await homeApi.tasks(true, signal)
    await homeApi.notifySettings(signal)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/dev/api/home/models', '/dev/api/home/projects/pantheon/threads',
      '/dev/api/home/projects/pantheon/discussion?thread=thread+%26+1',
      '/dev/api/home/fields', '/dev/api/home/tasks?all=1', '/dev/api/home/notify-settings',
    ])
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET' && init.signal === signal && init.body === undefined)).toBe(true)
  })

  it('uses exact methods, encoded path segments, revisions and asynchronous thread bodies', async () => {
    const fetch = mockAPI({})
    await homeApi.createThread('pantheon')
    await homeApi.renameThread('pantheon', 'thread/1', 'New title')
    await homeApi.deleteThread('pantheon', 'thread/1')
    await homeApi.retryMessage('pantheon', 'assistant/1')
    await homeApi.sendMessage('pantheon', 'Hello', { harness: 'claude', model: 'custom' }, 'thread/1')
    await homeApi.patchTask('pantheon', 'A2', { rev: 'seen', title: 'Renamed', priority: 'P0', tags: ['前端'], owner: 'cyx', due: '2026-10-12', secondary: 'codex/model', dependsOn: ['A1'] })
    await homeApi.patchMeta('pantheon', { rev: '', labels: ['产品'], priority: 'P1', phase: '开发', pinned: true })
    await homeApi.replyReport('pantheon', '问题 & reply.md', 'Approved', 'report-rev')
    const calls = fetch.mock.calls.map(([url, init]) => [url, init.method, init.body === undefined ? undefined : JSON.parse(init.body)])
    expect(calls).toEqual([
      ['/dev/api/home/projects/pantheon/threads', 'POST', {}],
      ['/dev/api/home/projects/pantheon/threads/thread%2F1', 'PATCH', { title: 'New title' }],
      ['/dev/api/home/projects/pantheon/threads/thread%2F1', 'DELETE', undefined],
      ['/dev/api/home/projects/pantheon/discussion/assistant%2F1/retry', 'POST', undefined],
      ['/dev/api/home/projects/pantheon/discussion', 'POST', { message: 'Hello', executor: { harness: 'claude', model: 'custom' }, thread: 'thread/1' }],
      ['/dev/api/home/projects/pantheon/tasks/A2', 'PATCH', { rev: 'seen', title: 'Renamed', priority: 'P0', tags: ['前端'], owner: 'cyx', due: '2026-10-12', secondary: 'codex/model', dependsOn: ['A1'] }],
      ['/dev/api/home/projects/pantheon/meta', 'PATCH', { rev: '', labels: ['产品'], priority: 'P1', phase: '开发', pinned: true }],
      ['/dev/api/home/projects/pantheon/reports/%E9%97%AE%E9%A2%98%20%26%20reply.md/reply', 'POST', { text: 'Approved', rev: 'report-rev' }],
    ])
  })

  it('keeps omitted notification secrets distinct from explicit clearing', async () => {
    const fetch = mockAPI({ ok: true })
    await homeApi.putNotifySettings({ mode: 'dry_run', publicUrl: 'https://panel.test' })
    await homeApi.putNotifySettings({ webhookUrl: '', secret: '' })
    await homeApi.testNotification()
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body === undefined ? undefined : JSON.parse(init.body)])).toEqual([
      ['/dev/api/home/notify-settings', 'PUT', { mode: 'dry_run', publicUrl: 'https://panel.test' }],
      ['/dev/api/home/notify-settings', 'PUT', { webhookUrl: '', secret: '' }],
      ['/dev/api/home/notify-settings/test', 'POST', undefined],
    ])
  })

  it('sends the whole field catalogue with its displayed revision', async () => {
    const { fieldsFixture } = await import('../components/home/fixtures')
    const fetch = mockAPI({})
    await homeApi.putFields(fieldsFixture)
    expect(fetch.mock.calls[0][0]).toBe('/dev/api/home/fields')
    expect(fetch.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(fieldsFixture)
  })
})
