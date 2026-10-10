import type { HomeGPU, HomeResource, HomeResourceKind, HomeResourceSecret, HomeServerBoard, HomeServerState, HomeServerStatus } from '../../protocol/home'
import type { HomeFieldColor } from '../../protocol/home'

export type ResourceFilter = HomeResourceKind | 'all'

export function filterResources(resources: readonly HomeResource[], kind: ResourceFilter, query: string): HomeResource[] {
  const needle = query.trim().toLocaleLowerCase()
  return resources.filter((resource) => (kind === 'all' || resource.kind === kind) &&
    [resource.id, resource.title, resource.provider, resource.sshAlias, resource.url, resource.body, ...resource.env, ...resource.tags]
      .join(' ').toLocaleLowerCase().includes(needle))
}

export function serverChip(state: HomeServerState): { color: HomeFieldColor; icon: 'check' | 'clock' | 'disconnected' | 'unknown' } {
  switch (state) {
    case 'fresh': return { color: 'green', icon: 'check' }
    case 'stale': return { color: 'yellow', icon: 'clock' }
    case 'disconnected': return { color: 'red', icon: 'disconnected' }
    default: return { color: 'gray', icon: 'unknown' }
  }
}

export function serverGroups(servers: readonly HomeServerStatus[]) {
  const groups = [...new Set(['atombit', 'hospital', 'zdq', 'ai4s', ...servers.map((server) => server.group).filter(Boolean)])]
  return groups.map((group) => {
    const members = servers.filter((server) => server.group === group)
    const fresh = members.filter((server) => server.state === 'fresh')
    return {
      group, total: members.length,
      connected: members.filter((server) => server.state === 'fresh' || server.state === 'stale').length,
      freshGPUs: fresh.reduce((sum, server) => sum + server.gpus.length, 0),
      lowUsage: fresh.reduce((sum, server) => sum + server.gpus.filter((gpu) => gpu.observation === 'low_usage').length, 0),
    }
  })
}

export function boardStale(board: HomeServerBoard, now: number): boolean {
  const at = Date.parse(board.collectedAt)
  return !board.available || !Number.isFinite(at) || now - at > board.staleAfterSeconds * 1000
}

export function gpuMemoryPercent(gpu: HomeGPU): number | null {
  if (gpu.memoryTotalMib === null || gpu.memoryUsedMib === null || !Number.isFinite(gpu.memoryTotalMib) || !Number.isFinite(gpu.memoryUsedMib) || gpu.memoryTotalMib <= 0 || gpu.memoryUsedMib < 0) return null
  return Math.max(0, Math.min(100, gpu.memoryUsedMib / gpu.memoryTotalMib * 100))
}

export function resourceNames(value: string): string[] {
  return [...new Set(value.split(/[,\n，]/).map((item) => item.trim()).filter(Boolean))]
}

export function resourceSecrets(resource: Pick<HomeResource, 'env' | 'secrets'>): HomeResourceSecret[] {
  return [...new Set([...resource.env, ...resource.secrets.map((secret) => secret.name)])]
    .map((name) => resource.secrets.find((secret) => secret.name === name) ?? { name, configured: false, updatedAt: '' })
}

export function emptySecretDraft(secrets: readonly HomeResourceSecret[]): Record<string, string> {
  return Object.fromEntries(secrets.map((secret) => [secret.name, '']))
}

export function secretEdits(draft: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(draft).filter(([, value]) => value !== '').map(([name, value]) => ({ name, value }))
}

export function secretValueFits(value: string): boolean {
  return new TextEncoder().encode(value).length <= 8192
}

export function toggleResourceScope(scope: readonly string[], id: string): string[] {
  if (id === '*') return scope.includes('*') ? [] : ['*']
  const selected = scope.filter((value) => value !== '*')
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
}

export function selectedResources(resources: readonly Pick<HomeResource, 'id'>[], defaults: readonly string[]): string[] {
  const allowed = new Set(resources.map((resource) => resource.id))
  return [...new Set(defaults)].filter((id) => allowed.has(id))
}

export function resourceHref(value: string): string | null {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
