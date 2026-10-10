import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeAPIError, homeApi } from './home'
import { resourceDetailFixture, resourceFixture } from '../components/home/resourceFixtures'

afterEach(() => vi.unstubAllGlobals())
function mockAPI(value: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(async () => new Response(status === 204 ? null : JSON.stringify(value), { status }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev' }) })
  return fetch
}

describe('Stage B resource API', () => {
  it('reads the exact list, detail, snapshot and allowed-project shapes under the base path', async () => {
    const data = { resources: [resourceFixture], orphans: [{ resourceId: 'missing', names: ['KEY'] }], warnings: [] }
    const fetch = mockAPI(data)
    const signal = new AbortController().signal
    expect(await homeApi.resources(signal)).toEqual(data)
    await homeApi.resource('api/id', signal)
    await homeApi.servers(signal)
    await homeApi.projectResources('project/id', signal)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/dev/api/home/resources', '/dev/api/home/resources/api%2Fid', '/dev/api/home/servers', '/dev/api/home/projects/project%2Fid/resources'])
    expect(fetch.mock.calls.every(([, init]) => init.method === 'GET' && init.signal === signal && init.body === undefined)).toBe(true)
    mockAPI(resourceDetailFixture)
    expect(await homeApi.resource('api-main')).toEqual(resourceDetailFixture)
  })
  it('sends camelCase metadata with the revision seen by the editor, and runs checks only by POST', async () => {
    const fetch = mockAPI(resourceFixture)
    const resource = { id: 'api-main', kind: 'api' as const, title: 'API', env: ['API_KEY'], baseUrl: 'https://example.test/v1', projects: ['*'], body: '## Usage' }
    await homeApi.createResource(resource)
    await homeApi.patchResource('api-main', { rev: 'seen', sshAlias: 'gpu-1', gpuBoardId: 'node-1', projects: ['pantheon'] })
    await homeApi.checkResource('api-main')
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body === undefined ? undefined : JSON.parse(init.body)])).toEqual([
      ['/dev/api/home/resources', 'POST', resource],
      ['/dev/api/home/resources/api-main', 'PATCH', { rev: 'seen', sshAlias: 'gpu-1', gpuBoardId: 'node-1', projects: ['pantheon'] }],
      ['/dev/api/home/resources/api-main/check', 'POST', undefined],
    ])
  })
  it('puts secrets only in a JSON body, encodes ids and names, and handles empty delete responses', async () => {
    const fetch = mockAPI({ name: 'API_KEY', configured: true, updatedAt: 'now' })
    expect(await homeApi.putResourceSecret('api/id', 'API/KEY', 'new-key')).toEqual({ name: 'API_KEY', configured: true, updatedAt: 'now' })
    expect(fetch.mock.calls[0][0]).toBe('/dev/api/home/resources/api%2Fid/secrets/API%2FKEY')
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: '{"value":"new-key"}' })
    const deletes = mockAPI(null, 204)
    await homeApi.deleteResourceSecret('missing', 'KEY')
    await homeApi.deleteResource('api/id', 'rev & 1')
    expect(deletes.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/dev/api/home/resources/missing/secrets/KEY', 'DELETE', undefined],
      ['/dev/api/home/resources/api%2Fid?rev=rev+%26+1', 'DELETE', undefined],
    ])
  })
  it('imports aliases or profile ids without copying profile values through the browser', async () => {
    const fetch = mockAPI({ created: ['gpu-1'], skipped: [] })
    expect(await homeApi.importSSHResources(['gpu-1'])).toEqual({ created: ['gpu-1'], skipped: [] })
    await homeApi.importProfileResource('builtin:codex')
    await homeApi.importProfileResource('profile', 'api-main')
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(init.body)])).toEqual([
      ['/dev/api/home/resources/import/ssh', 'POST', { aliases: ['gpu-1'] }],
      ['/dev/api/home/resources/import/profile', 'POST', { profileId: 'builtin:codex' }],
      ['/dev/api/home/resources/import/profile', 'POST', { profileId: 'profile', resourceId: 'api-main' }],
    ])
  })
  it('leaves a stale resource write for the user to review instead of retrying', async () => {
    const fetch = mockAPI({ error: 'stale', rev: 'current' }, 409)
    const pending = homeApi.patchResource('api-main', { rev: 'seen', title: 'Rename' })
    await expect(pending).rejects.toBeInstanceOf(HomeAPIError)
    await expect(pending).rejects.toMatchObject({ status: 409, rev: 'current' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
