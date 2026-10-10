import type { HomeGPU, HomeResource, HomeResourceDetail, HomeServerStatus } from '../../protocol/home'

export const gpuFixture: HomeGPU = {
  index: 0, name: 'GPU', memoryTotalMib: 24000, memoryUsedMib: 6000, utilizationPct: 5,
  temperatureC: 35, powerW: 60, migMode: 'disabled', observation: 'low_usage',
}
export const serverFixture: HomeServerStatus = {
  id: 'node-1', alias: 'gpu-1', group: 'atombit', label: 'Compute', state: 'fresh',
  reachability: 'reachable', telemetry: 'ok', lastSuccessAt: '2026-10-10T10:00:00Z',
  lastMetricsAt: '2026-10-10T10:00:00Z', ageSeconds: 10, errorCode: '', gpus: [gpuFixture], resourceId: 'gpu-1',
}
export const resourceFixture: HomeResource = {
  id: 'api-main', kind: 'api', title: 'Main provider', provider: 'openai', baseUrl: 'https://api.example.test/v1',
  env: ['OPENAI_API_KEY', 'EXTRA_TOKEN'], sshAlias: '', gpuBoardId: '', url: '', projects: ['*'], tags: ['models'],
  check: 'provider', updated: '2026-10-10T10:00:00Z', body: '## Usage\nUse for planning.', rev: 'resource-rev', file: 'api-main.md',
  secrets: [{ name: 'OPENAI_API_KEY', configured: true, updatedAt: '2026-10-10T09:00:00Z' }, { name: 'EXTRA_TOKEN', configured: false, updatedAt: '' }],
  lastCheck: { at: '2026-10-10T10:00:00Z', ok: true, summary: '200' }, server: null,
}
export const resourceDetailFixture: HomeResourceDetail = {
  ...resourceFixture, checks: [{ ...resourceFixture.lastCheck!, detail: { status: 200, modelCount: 2, models: ['model-a', 'model-b'] } }],
  uses: [{ purpose: 'session', projectId: 'pantheon', sessionId: 'vp_1', at: '2026-10-10T10:00:00Z' }],
}
