import { useCallback, type MouseEvent } from 'react'
import { CheckCircle2, Circle, KeyRound, Play, XCircle } from 'lucide-react'
import { t } from '../../i18n'
import { homeApi, type HomeResource, type HomeResourceCheck, type HomeResourceSecret } from '../../protocol/home'
import { homeResourceLink } from '../../routes'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'
import { HomeChip } from './HomeField'
import { HomeBoardLink, HomeServerMetrics } from './HomeResourceStatus'
import { resourceHref, resourceSecrets } from './resources'
import { useHomeResource } from './useHomeResource'

export function HomeSecretStatus({ secret }: { secret: HomeResourceSecret }) {
  const Icon = secret.configured ? CheckCircle2 : Circle
  return <span className="inline-flex max-w-full flex-wrap items-center gap-1 text-vp-xs"><Icon size={13} className={`shrink-0 ${secret.configured ? 'text-state-done' : 'text-ink-3'}`} /><span>{safeText(secret.name)}</span><span className="text-ink-2">{t(secret.configured ? 'home.res.configured' : 'home.res.unconfigured')}</span></span>
}

export function HomeResourceCheckResult({ check }: { check: Pick<HomeResourceCheck, 'at' | 'ok' | 'summary'> | null }) {
  if (!check) return <p className="text-vp-xs text-ink-2">{t('home.res.unchecked')}</p>
  const Icon = check.ok ? CheckCircle2 : XCircle
  return <div className="min-w-0 space-y-1 text-vp-xs"><div className="flex flex-wrap items-center gap-1"><Icon size={14} className="shrink-0" /><span>{t(check.ok ? 'home.res.checkOK' : 'home.res.checkFailed')}</span><HomeTime at={check.at} /></div><p className="text-ink-2">{safeText(check.summary)}</p></div>
}

export function HomeResourceURL({ url }: { url: string }) {
  const href = resourceHref(url)
  return href ? <a className="break-words text-vp-sm text-accent underline" href={href} target="_blank" rel="noopener noreferrer">{safeText(url)}</a> : <span className="break-words text-vp-sm text-ink-2">{safeText(url)}</span>
}

export function HomeResourceCard({ resource, boardURL, busy, checking, onCheck, onSecrets, onNavigate }: {
  resource: HomeResource
  boardURL: string
  busy: boolean
  checking?: boolean
  onCheck: (resource: HomeResource) => void
  onSecrets: (resource: HomeResource) => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const { id, kind } = resource
  const checkedAt = resource.lastCheck?.at
  // The list deliberately carries only a check summary. Read stored details
  // for model counts; rendering a card must never run a provider check.
  const load = useCallback(async (signal: AbortSignal) => kind === 'api' && checkedAt ? homeApi.resource(id, signal) : null, [id, kind, checkedAt])
  const details = useHomeResource(load, false)
  const count = details.data?.checks.find((check) => check.at === checkedAt)?.detail?.modelCount
  return <article className="flex min-w-0 flex-col gap-3 rounded-vp-lg border border-hairline bg-surface p-4" data-testid="home-resource-card">
    <div className="min-w-0"><a href={homeResourceLink(id)} onClick={onNavigate} className="block break-words font-semibold text-accent">{safeText(resource.title)}</a><p className="mt-1 text-vp-xs text-ink-2">{t(`home.res.kind.${kind}`)} · {safeText(id)}</p></div>
    {kind === 'api' && <><p className="text-vp-sm">{resource.provider ? t(`home.res.provider.${resource.provider}`) : t('home.res.unknown')}</p><div className="flex flex-wrap gap-2">{resourceSecrets(resource).map((secret) => <HomeSecretStatus key={secret.name} secret={secret} />)}</div></>}
    {kind === 'server' ? <><p className="text-vp-sm text-ink-2">{safeText(resource.sshAlias)}</p><HomeServerMetrics server={resource.server} /></> : resource.url && <HomeResourceURL url={resource.url} />}
    {resource.tags.length > 0 && <div className="flex flex-wrap gap-1">{resource.tags.map((tag) => <HomeChip key={tag} value={tag} />)}</div>}
    <HomeResourceCheckResult check={resource.lastCheck} />
    {kind === 'api' && resource.lastCheck && <p className="text-vp-xs text-ink-2">{typeof count === 'number' ? t('home.res.modelCount', { count }) : t('home.res.modelCountUnknown')}</p>}
    <div className="mt-auto flex flex-wrap gap-2">
      {kind === 'api' && <button type="button" className="vp-control home-wrap-control" onClick={() => onSecrets(resource)}><KeyRound size={14} className="shrink-0" />{t('home.res.setSecrets')}</button>}
      {resource.check !== 'none' && <button type="button" className="vp-control home-wrap-control" disabled={busy} onClick={() => onCheck(resource)}><Play size={14} className="shrink-0" />{checking ? t('home.res.checking') : t(resource.check === 'ssh' ? 'home.res.checkSSH' : 'home.res.checkNow')}</button>}
      {kind === 'server' && <HomeBoardLink url={boardURL} />}
    </div>
  </article>
}
