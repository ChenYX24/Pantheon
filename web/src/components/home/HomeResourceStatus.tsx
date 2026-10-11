import { CheckCircle2, CircleHelp, Clock, ExternalLink, Unplug } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeGPU, HomeServerState, HomeServers, HomeServerStatus } from '../../protocol/home'
import { safeText } from '../text'
import { StatusPill } from '../shell/StatusPill'
import { useHomeClock } from './clock'
import { HomeTime } from './HomeCard'
import { boardStale, gpuMemoryPercent, resourceHref, serverChip, serverGroups } from './resources'

export function HomeServerChip({ state }: { state: HomeServerState }) {
  const chip = serverChip(state)
  const Icon = { check: CheckCircle2, clock: Clock, disconnected: Unplug, unknown: CircleHelp }[chip.icon]
  return <StatusPill label={t(`home.res.state.${state}`)} color={chip.color} icon={Icon} state={state} />
}

export function HomeBoardLink({ url }: { url: string }) {
  const href = resourceHref(url)
  return href && <a className="vp-control home-wrap-control" href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} className="shrink-0" />{t('home.res.openBoard')}</a>
}

export function HomeServerOverview({ data }: { data: HomeServers }) {
  const now = useHomeClock()
  const stale = boardStale(data.board, now)
  return <section className="@container min-w-0 space-y-3 rounded-vp-lg border border-hairline bg-surface p-4" aria-label={t('home.res.servers')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-vp-md font-semibold">{t('home.res.servers')}</h2><HomeBoardLink url={data.board.url} /></div>
    <div className="flex flex-wrap items-center gap-2 text-vp-sm text-ink-2"><span>{t('home.res.snapshot')}</span><HomeTime at={data.board.collectedAt} />{stale && <span role="status" className="flex items-center gap-1"><Clock size={14} />{t(data.board.available ? 'home.res.snapshotStale' : 'home.res.boardUnavailable')}</span>}</div>
    {data.board.available && <div className="grid min-w-0 grid-cols-2 gap-3 @4xl:grid-cols-4">{serverGroups(data.servers).map((group) => <div key={group.group} className="min-w-0 rounded-vp border border-hairline p-4">
      <h3 className="font-medium">{safeText(group.group)}</h3><p className="mt-1 text-vp-sm text-ink-2">{t('home.res.connectedCount', { count: group.connected, total: group.total })}</p><p className="text-vp-xs text-ink-2">{t('home.res.freshGPUCount', { count: group.freshGPUs })}</p><p className="text-vp-xs text-ink-2">{t('home.res.lowUsageCount', { count: group.lowUsage })}</p>
    </div>)}</div>}
    <p className="text-vp-xs text-ink-2">{t('home.res.observationOnly')}</p>
  </section>
}

function GPU({ gpu, fresh }: { gpu: HomeGPU; fresh: boolean }) {
  const percent = gpuMemoryPercent(gpu)
  const known = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? Math.round(value) : t('home.res.unknown')
  const low = fresh && gpu.observation === 'low_usage'
  const memory = t('home.res.memory', { used: known(gpu.memoryUsedMib), total: known(gpu.memoryTotalMib) })
  const utilization = gpu.utilizationPct === null || !Number.isFinite(gpu.utilizationPct) || gpu.utilizationPct < 0 ? null : Math.min(100, Math.round(gpu.utilizationPct))
  return <li className="home-gpu">
    <span className="home-gpu-name" title={`${t('home.res.gpu', { index: gpu.index })} · ${safeText(gpu.name)}${low ? ` · ${t('home.res.lowUsage')}` : ''}`}>{gpu.index} · {safeText(gpu.name.replace(/^(NVIDIA|AMD|Tesla)\s+/i, ''))}{low && <CheckCircle2 size={12} className="ml-1 inline" aria-label={t('home.res.lowUsage')} />}</span>
    <span title={memory}>{percent !== null ? <span role="progressbar" aria-label={t('home.res.memoryLabel')} aria-valuetext={memory} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="block h-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-accent" style={{ width: `${percent}%` }} /></span> : <span className="text-ink-2">{t('home.res.unknown')}</span>}</span>
    <span className="text-right text-ink-2" title={utilization === null ? t('home.res.utilizationUnknown') : t('home.res.utilization', { percent: utilization })}>{utilization === null ? '—' : `${utilization}%`}</span>
  </li>
}

export function HomeServerMetrics({ server, showState = true }: { server: HomeServerStatus | null; showState?: boolean }) {
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-2">{showState && <HomeServerChip state={server?.state ?? 'unknown'} />}<span className="text-vp-xs text-ink-2">{t('home.res.lastSeen')} {server?.lastSuccessAt ? <HomeTime at={server.lastSuccessAt} /> : t('home.res.unknown')}</span></div>
    {server && <>
      {server.label && <p className="text-vp-sm">{safeText(server.label)}</p>}
      {server.gpus.length > 0 && <ul className="min-w-0 space-y-2">{server.gpus.map((gpu) => <GPU key={gpu.index} gpu={gpu} fresh={server.state === 'fresh'} />)}</ul>}
      {server.state === 'fresh' && server.gpus.some((gpu) => gpu.observation === 'low_usage') && <p className="text-vp-xs text-ink-2">{t('home.res.observationOnly')}</p>}
      {server.errorCode && <p className="text-vp-xs text-ink-2">{safeText(server.errorCode)}</p>}
    </>}
  </div>
}
