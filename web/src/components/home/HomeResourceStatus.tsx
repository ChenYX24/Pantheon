import { CheckCircle2, CircleHelp, Clock, ExternalLink, Unplug } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeGPU, HomeServerState, HomeServers, HomeServerStatus } from '../../protocol/home'
import { safeText } from '../text'
import { optionColor } from './board'
import { useHomeClock } from './clock'
import { HomeTime } from './HomeCard'
import { boardStale, gpuMemoryPercent, resourceHref, serverChip, serverGroups } from './resources'

export function HomeServerChip({ state }: { state: HomeServerState }) {
  const chip = serverChip(state)
  const color = optionColor(chip.color)
  const Icon = { check: CheckCircle2, clock: Clock, disconnected: Unplug, unknown: CircleHelp }[chip.icon]
  return <span className="inline-flex max-w-full items-center gap-1 rounded-vp border px-2 py-0.5 text-vp-xs" style={{ borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}><Icon size={13} className="shrink-0" style={{ color }} />{t(`home.res.state.${state}`)}</span>
}

export function HomeBoardLink({ url }: { url: string }) {
  const href = resourceHref(url)
  return href && <a className="vp-control home-wrap-control" href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} className="shrink-0" />{t('home.res.openBoard')}</a>
}

export function HomeServerOverview({ data }: { data: HomeServers }) {
  const now = useHomeClock()
  const stale = boardStale(data.board, now)
  return <section className="@container min-w-0 space-y-3 rounded-vp-lg border border-hairline bg-surface p-3" aria-label={t('home.res.servers')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-vp-md font-semibold">{t('home.res.servers')}</h2><HomeBoardLink url={data.board.url} /></div>
    <div className="flex flex-wrap items-center gap-2 text-vp-sm text-ink-2"><span>{t('home.res.snapshot')}</span><HomeTime at={data.board.collectedAt} />{stale && <span role="status" className="flex items-center gap-1"><Clock size={14} />{t(data.board.available ? 'home.res.snapshotStale' : 'home.res.boardUnavailable')}</span>}</div>
    {data.board.available && <div className="grid min-w-0 gap-2 @lg:grid-cols-2 @4xl:grid-cols-4">{serverGroups(data.servers).map((group) => <div key={group.group} className="min-w-0 rounded-vp border border-hairline p-3">
      <h3 className="font-medium">{safeText(group.group)}</h3><p className="mt-1 text-vp-sm text-ink-2">{t('home.res.connectedCount', { count: group.connected, total: group.total })}</p><p className="text-vp-sm text-ink-2">{t('home.res.freshGPUCount', { count: group.freshGPUs })}</p><p className="text-vp-sm text-ink-2">{t('home.res.lowUsageCount', { count: group.lowUsage })}</p>
    </div>)}</div>}
    <p className="text-vp-xs text-ink-2">{t('home.res.observationOnly')}</p>
  </section>
}

function GPU({ gpu, fresh }: { gpu: HomeGPU; fresh: boolean }) {
  const percent = gpuMemoryPercent(gpu)
  const known = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? Math.round(value) : t('home.res.unknown')
  return <li className="min-w-0 space-y-1 rounded-vp border border-hairline p-2">
    <div className="flex flex-wrap items-center justify-between gap-1 text-vp-sm"><span>{t('home.res.gpu', { index: gpu.index })} · {safeText(gpu.name)}</span>{fresh && gpu.observation === 'low_usage' && <span className="rounded-vp border border-hairline px-1.5 py-0.5 text-vp-xs">{t('home.res.lowUsage')}</span>}</div>
    <p className="text-vp-xs text-ink-2">{t('home.res.memory', { used: known(gpu.memoryUsedMib), total: known(gpu.memoryTotalMib) })}</p>
    {percent !== null && <div role="progressbar" aria-label={t('home.res.memoryLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${percent}%` }} /></div>}
    <p className="text-vp-xs text-ink-2">{gpu.utilizationPct === null || !Number.isFinite(gpu.utilizationPct) || gpu.utilizationPct < 0 ? t('home.res.utilizationUnknown') : t('home.res.utilization', { percent: Math.min(100, Math.round(gpu.utilizationPct)) })}</p>
  </li>
}

export function HomeServerMetrics({ server }: { server: HomeServerStatus | null }) {
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-2"><HomeServerChip state={server?.state ?? 'unknown'} /><span className="text-vp-xs text-ink-2">{t('home.res.lastSeen')} {server?.lastSuccessAt ? <HomeTime at={server.lastSuccessAt} /> : t('home.res.unknown')}</span></div>
    {server && <>
      {server.label && <p className="text-vp-sm">{safeText(server.label)}</p>}
      {server.gpus.length > 0 && <ul className="min-w-0 space-y-2">{server.gpus.map((gpu) => <GPU key={gpu.index} gpu={gpu} fresh={server.state === 'fresh'} />)}</ul>}
      {server.state === 'fresh' && server.gpus.some((gpu) => gpu.observation === 'low_usage') && <p className="text-vp-xs text-ink-2">{t('home.res.observationOnly')}</p>}
      {server.errorCode && <p className="text-vp-xs text-ink-2">{safeText(server.errorCode)}</p>}
    </>}
  </div>
}
