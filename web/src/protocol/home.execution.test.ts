import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeApi } from './home'
import { runFixture, executionFixture } from '../components/home/executionFixtures'

afterEach(() => vi.unstubAllGlobals())
function mockAPI(data: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev' }) })
  return fetch
}

describe('Stage E1 execution requests', () => {
  it('reads the exact switch, run array and flat detail shapes under the mount', async () => {
    const signal = new AbortController().signal
    const fetch = mockAPI(executionFixture)
    expect(await homeApi.execution(signal)).toEqual(executionFixture)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify([runFixture])))
    expect(await homeApi.runs('project name', signal)).toEqual([runFixture])
    const detail = { ...runFixture, log: 'tail', handoff: 'handoff-001.md' }
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(detail)))
    expect(await homeApi.run('project name', 'run/1', signal)).toEqual(detail)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/dev/api/home/execution', '/dev/api/home/projects/project%20name/runs', '/dev/api/home/projects/project%20name/runs/run%2F1'])
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET' && init.signal === signal && init.body === undefined)).toBe(true)
  })

  it('sends only enabled for the switch and no invented bodies for run actions', async () => {
    const fetch = mockAPI({})
    fetch.mockImplementation(async () => new Response('{}'))
    await homeApi.putExecution(true)
    await homeApi.putExecution(false)
    await homeApi.runTask('project name', 'task/1')
    await homeApi.stopRun('project name', 'run/1')
    await homeApi.mergeRun('project name', 'run/1')
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body === undefined ? undefined : JSON.parse(init.body)])).toEqual([
      ['/dev/api/home/execution', 'PUT', { enabled: true }],
      ['/dev/api/home/execution', 'PUT', { enabled: false }],
      ['/dev/api/home/projects/project%20name/tasks/task%2F1/run', 'POST', undefined],
      ['/dev/api/home/projects/project%20name/runs/run%2F1/stop', 'POST', undefined],
      ['/dev/api/home/projects/project%20name/runs/run%2F1/merge', 'POST', undefined],
    ])
  })

  it('keeps execution refusals distinct from a stale file revision and never retries a write', async () => {
    const fetch = mockAPI({ error: 'merge conflict, replan' }, 409)
    await expect(homeApi.mergeRun('pantheon', 'run_1')).rejects.toMatchObject({ status: 409, message: 'merge conflict, replan', stale: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    mockAPI({ error: 'stale', rev: 'latest' }, 409)
    await expect(homeApi.patchMeta('pantheon', { rev: 'seen', autonomy: 'full' })).rejects.toMatchObject({ status: 409, stale: true, rev: 'latest' })
  })
})
