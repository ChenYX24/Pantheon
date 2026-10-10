import { describe, expect, it } from 'vitest'
import { HOME_RESOURCE_KINDS } from '../../protocol/home'
import { boardStale, emptySecretDraft, filterResources, gpuMemoryPercent, resourceChanges, resourceHref, resourceNames, resourceSecrets, secretEdits, secretValueFits, selectedResources, serverChip, serverGroups, toggleResourceScope } from './resources'
import { safeBody, safeText } from '../text'
import { gpuFixture, resourceFixture, serverFixture } from './resourceFixtures'

describe('resource filters', () => {
  const resources = HOME_RESOURCE_KINDS.map((kind) => ({ ...resourceFixture, id: kind, kind }))
  it('keeps every kind reachable and combines kind and case-insensitive search', () => {
    for (const kind of HOME_RESOURCE_KINDS) expect(filterResources(resources, kind, 'MAIN provider').map((resource) => resource.kind)).toEqual([kind])
    expect(filterResources(resources, 'all', '  ')).toEqual(resources)
    expect(filterResources(resources, 'api', 'missing')).toEqual([])
  })
  it('searches ids, variable names, usage, tags and host aliases without changing the list', () => {
    for (const query of ['api-main', 'openai_api_key', 'planning', 'models']) expect(filterResources([resourceFixture], 'all', query)).toEqual([resourceFixture])
    expect(filterResources([{ ...resourceFixture, kind: 'server', sshAlias: 'Lab-GPU' }], 'server', 'lab-gpu')).toHaveLength(1)
    expect(resources.map((resource) => resource.kind)).toEqual(HOME_RESOURCE_KINDS)
  })
})

describe('snapshot summaries', () => {
  it('counts connected hosts and only fresh GPU observations, without inferring permission', () => {
    const servers = [serverFixture, { ...serverFixture, id: 'old', state: 'stale' as const }, { ...serverFixture, id: 'down', state: 'disconnected' as const }, { ...serverFixture, id: 'unknown', state: 'unknown' as const }, { ...serverFixture, id: 'busy', gpus: [{ ...gpuFixture, observation: 'usage_observed' as const }] }]
    expect(serverGroups(servers)).toEqual([
      { group: 'atombit', total: 5, connected: 3, freshGPUs: 2, lowUsage: 1 },
      { group: 'hospital', total: 0, connected: 0, freshGPUs: 0, lowUsage: 0 },
      { group: 'zdq', total: 0, connected: 0, freshGPUs: 0, lowUsage: 0 },
      { group: 'ai4s', total: 0, connected: 0, freshGPUs: 0, lowUsage: 0 },
    ])
    expect(serverGroups([{ ...serverFixture, group: 'new-group' }]).at(-1)).toMatchObject({ group: 'new-group', freshGPUs: 1 })
  })
  it('gives states both a color and a distinct glyph', () => {
    expect(serverChip('fresh')).toEqual({ color: 'green', icon: 'check' })
    expect(serverChip('stale')).toEqual({ color: 'yellow', icon: 'clock' })
    expect(serverChip('disconnected')).toEqual({ color: 'red', icon: 'disconnected' })
    expect(serverChip('unknown')).toEqual({ color: 'gray', icon: 'unknown' })
    expect(serverChip('unsupported')).toEqual({ color: 'gray', icon: 'unknown' })
  })
  it('marks a missing, invalid or older-than-180-second snapshot stale', () => {
    const board = { available: true, collectedAt: '2026-10-10T10:00:00Z', staleAfterSeconds: 180, url: '' }
    const at = Date.parse(board.collectedAt)
    expect(boardStale(board, at + 180000)).toBe(false)
    expect(boardStale(board, at + 180001)).toBe(true)
    expect(boardStale({ ...board, available: false }, at)).toBe(true)
    expect(boardStale({ ...board, collectedAt: '' }, at)).toBe(true)
  })
  it('keeps missing memory distinct from zero and clamps over-range readings', () => {
    expect(gpuMemoryPercent(gpuFixture)).toBe(25)
    expect(gpuMemoryPercent({ ...gpuFixture, memoryUsedMib: 0 })).toBe(0)
    expect(gpuMemoryPercent({ ...gpuFixture, memoryUsedMib: null })).toBeNull()
    expect(gpuMemoryPercent({ ...gpuFixture, memoryTotalMib: 0 })).toBeNull()
    expect(gpuMemoryPercent({ ...gpuFixture, memoryUsedMib: -1 })).toBeNull()
    expect(gpuMemoryPercent({ ...gpuFixture, memoryUsedMib: 30000 })).toBe(100)
  })
})

describe('secret dialog state', () => {
  it('starts blank regardless of configuration and retains every declared or stored name', () => {
    const secrets = resourceSecrets({ env: ['API_KEY', 'NEW_TOKEN'], secrets: [{ name: 'API_KEY', configured: true, updatedAt: 'today' }, { name: 'OLD_SECRET', configured: true, updatedAt: 'yesterday' }] })
    expect(secrets.map((secret) => secret.name)).toEqual(['API_KEY', 'NEW_TOKEN', 'OLD_SECRET'])
    expect(secrets[1]).toEqual({ name: 'NEW_TOKEN', configured: false, updatedAt: '' })
    expect(emptySecretDraft(secrets)).toEqual({ API_KEY: '', NEW_TOKEN: '', OLD_SECRET: '' })
    expect(secretEdits(emptySecretDraft(secrets))).toEqual([])
  })
  it('omits blanks, preserves exact input and allows only 8 KiB per value', () => {
    expect(secretEdits({ API_KEY: '  new-key\n', NEW_TOKEN: '' })).toEqual([{ name: 'API_KEY', value: '  new-key\n' }])
    expect(secretValueFits('a'.repeat(8192))).toBe(true)
    expect(secretValueFits('a'.repeat(8193))).toBe(false)
    expect(secretValueFits('密'.repeat(2730))).toBe(true)
    expect(secretValueFits('密'.repeat(2731))).toBe(false)
  })
})

describe('resource scope and selection', () => {
  it('patches only edited fields, without normalizing an untouched document on metadata saves', () => {
    const resource = { ...resourceFixture, title: 'Title\u202E', body: '## Usage\r\n\r\nText\u202E\r\n' }
    const displayed = { kind: resource.kind, title: safeText(resource.title), body: safeBody(resource.body), tags: [...resource.tags], projects: [...resource.projects] }
    expect(resourceChanges(resource, displayed)).toEqual({})
    expect(resourceChanges(resource, { ...displayed, title: 'Renamed' })).toEqual({ title: 'Renamed' })
    expect(resourceChanges(resource, { ...displayed, body: 'New instructions', projects: [] })).toEqual({ body: 'New instructions', projects: [] })
  })
  it('keeps wildcard scope exclusive and deselection explicit', () => {
    expect(toggleResourceScope(['pantheon', 'lab'], '*')).toEqual(['*'])
    expect(toggleResourceScope(['*'], '*')).toEqual([])
    expect(toggleResourceScope(['*'], 'pantheon')).toEqual(['pantheon'])
    expect(toggleResourceScope(['pantheon', 'unlisted'], 'pantheon')).toEqual(['unlisted'])
    expect(toggleResourceScope([], 'pantheon')).toEqual(['pantheon'])
  })
  it('preselects only allowed defaults, preserving an explicitly empty selection', () => {
    expect(selectedResources([{ id: 'a' }, { id: 'b' }], ['b', 'missing', 'a', 'b'])).toEqual(['b', 'a'])
    expect(selectedResources([{ id: 'a' }], [])).toEqual([])
  })
  it('normalizes names and refuses executable or credential-bearing links', () => {
    expect(resourceNames(' a, b，a\nc ')).toEqual(['a', 'b', 'c'])
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///data', '//example.test', 'https://user:password@example.test']) expect(resourceHref(url)).toBeNull()
    expect(resourceHref('https://board.example.test/nodes')).toBe('https://board.example.test/nodes')
  })
})
