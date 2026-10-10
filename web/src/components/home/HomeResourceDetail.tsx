import { useCallback, useState, type MouseEvent } from 'react'
import { ArrowLeft, KeyRound, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react'
import { t } from '../../i18n'
import { homeApi, type HomeProject, type HomeResource, type HomeResourceCheck } from '../../protocol/home'
import { HOME_RESOURCES_PATH, homeProjectLink, panelOpeningSession } from '../../routes'
import { askConfirm } from '../ask'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'
import { HomeChip } from './HomeField'
import { HomeResourceCheckResult, HomeResourceURL, HomeSecretStatus } from './HomeResourceCard'
import { HomeResourceEditor } from './HomeResourceEditor'
import { HomeResourceSecrets } from './HomeResourceSecrets'
import { HomeBoardLink, HomeServerMetrics } from './HomeResourceStatus'
import { resourceSecrets } from './resources'
import { useHomeMutation } from './useHomeMutation'
import { useHomeResource } from './useHomeResource'

export function HomeCheckHistory({ checks }: { checks: HomeResourceCheck[] }) {
  return <section className="min-w-0 space-y-3"><h2 className="font-semibold">{t('home.res.checks')}</h2>{!checks.length && <p className="text-vp-sm text-ink-2">{t('home.res.noChecks')}</p>}{checks.map((check, index) => <article key={`${check.at}:${index}`} className="min-w-0 space-y-2 rounded-vp border border-hairline p-3">
    <HomeResourceCheckResult check={check} />
    <div className="flex flex-wrap gap-2 text-vp-xs text-ink-2">
      {check.detail?.status !== undefined && <span>{t('home.res.httpStatus', { status: check.detail.status })}</span>}
      {check.detail?.ms !== undefined && <span>{t('home.res.duration', { ms: check.detail.ms })}</span>}
      {check.detail?.exitCode !== undefined && <span>{t('home.res.exitCode', { code: check.detail.exitCode })}</span>}
      {check.detail?.modelCount !== undefined && <span>{t('home.res.modelCount', { count: check.detail.modelCount })}</span>}
    </div>
    {!!check.detail?.models?.length && <details><summary className="cursor-pointer text-vp-xs">{t('home.res.models')}</summary><ul className="mt-1 space-y-1 text-vp-xs text-ink-2">{check.detail.models.map((model, index) => <li key={index}>{safeText(model)}</li>)}</ul></details>}
    {check.detail?.stderr && <p className="text-vp-xs text-ink-2">{safeText(check.detail.stderr)}</p>}
  </article>)}</section>
}

export function HomeResourceDetail({ id, projects, aliases, boardURL, onChanged, onNavigate, onGo }: {
  id: string
  projects: HomeProject[]
  aliases: string[]
  boardURL: string
  onChanged: () => Promise<unknown> | void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  onGo: (path: string) => void
}) {
  const load = useCallback((signal: AbortSignal) => homeApi.resource(id, signal), [id])
  const detail = useHomeResource(load)
  const [editing, setEditing] = useState<HomeResource | null>(null)
  const [secrets, setSecrets] = useState<HomeResource | null>(null)
  const [checking, setChecking] = useState(false)
  const changed = async () => { await detail.refresh(); await onChanged() }
  const { busy, run } = useHomeMutation(changed)
  const resource = detail.data
  return <div className="@container min-w-0 space-y-4" data-testid="home-resource-detail">
    <div className="flex flex-wrap items-center gap-2"><a className="vp-control" href={HOME_RESOURCES_PATH} onClick={onNavigate}><ArrowLeft size={15} />{t('home.res.title')}</a><button type="button" className="vp-control ml-auto" disabled={detail.loading} onClick={() => void detail.refresh()} title={t('home.refresh')}><RefreshCw size={15} /></button></div>
    {detail.error && <p role="alert" className="text-vp-sm">{safeText(detail.error)}</p>}
    {!resource && detail.loading && <p role="status">{t('home.loading')}</p>}
    {resource && <>
      <section className="min-w-0 space-y-3 rounded-vp-lg border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h1 className="text-vp-lg font-semibold">{safeText(resource.title)}</h1><p className="mt-1 text-vp-xs text-ink-2">{t(`home.res.kind.${resource.kind}`)} · {safeText(resource.id)}</p></div><button type="button" className="vp-control" disabled={busy} onClick={() => setEditing(resource)}><Pencil size={14} />{t('home.res.edit')}</button></div>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 text-vp-sm">
          {resource.kind === 'api' && <><dt className="text-ink-2">{t('home.res.provider')}</dt><dd>{resource.provider ? t(`home.res.provider.${resource.provider}`) : t('home.res.unknown')}</dd><dt className="text-ink-2">{t('home.res.baseUrl')}</dt><dd><HomeResourceURL url={resource.baseUrl} /></dd><dt className="text-ink-2">{t('home.res.balance')}</dt><dd>{t('home.res.unknown')}</dd></>}
          {resource.kind === 'server' && <><dt className="text-ink-2">{t('home.res.sshAlias')}</dt><dd>{safeText(resource.sshAlias)}</dd><dt className="text-ink-2">{t('home.res.gpuBoardId')}</dt><dd>{safeText(resource.gpuBoardId || resource.sshAlias)}</dd></>}
          {resource.url && <><dt className="text-ink-2">{t('home.res.url')}</dt><dd className="min-w-0"><HomeResourceURL url={resource.url} /></dd></>}
          <dt className="text-ink-2">{t('home.res.scope')}</dt><dd className="flex min-w-0 flex-wrap gap-1">{resource.projects.includes('*') ? t('home.res.allProjects') : resource.projects.length ? resource.projects.map((projectId) => <a key={projectId} className="max-w-full text-accent underline" href={homeProjectLink({ projectId, tab: 'info' })} onClick={onNavigate}>{safeText(projectId)}</a>) : t('home.res.noScope')}</dd>
          <dt className="text-ink-2">{t('home.res.checkMethod')}</dt><dd>{t(`home.res.check.${resource.check}`)}</dd>
          <dt className="text-ink-2">{t('home.res.updated')}</dt><dd><HomeTime at={resource.updated} /></dd>
        </dl>
        {!!resource.tags.length && <div className="flex flex-wrap gap-1">{resource.tags.map((tag) => <HomeChip key={tag} value={tag} />)}</div>}
        {resource.kind === 'server' && <><HomeServerMetrics server={resource.server} /><HomeBoardLink url={boardURL} /></>}
        <div className="flex flex-wrap items-center gap-2"><HomeResourceCheckResult check={resource.lastCheck} />{resource.check !== 'none' && <button type="button" className="vp-control home-wrap-control" disabled={busy} onClick={async () => {
          setChecking(true)
          try { await run(() => homeApi.checkResource(resource.id)) } finally { setChecking(false) }
        }}><Play size={14} />{t(checking ? 'home.res.checking' : resource.check === 'ssh' ? 'home.res.checkSSH' : 'home.res.checkNow')}</button>}</div>
      </section>
      <section className="min-w-0 space-y-3 rounded-vp-lg border border-hairline bg-surface p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('home.res.secrets')}</h2><button type="button" className="vp-control" onClick={() => setSecrets(resource)}><KeyRound size={14} />{t('home.res.setSecrets')}</button></div><div className="flex flex-wrap gap-2">{resourceSecrets(resource).map((secret) => <HomeSecretStatus key={secret.name} secret={secret} />)}</div>{!resourceSecrets(resource).length && <p className="text-vp-sm text-ink-2">{t('home.res.noSecretNames')}</p>}</section>
      <section className="min-w-0 rounded-vp-lg border border-hairline bg-surface p-4"><h2 className="mb-3 font-semibold">{t('home.res.usageDoc')}</h2><div className="min-w-0 overflow-hidden"><Markdown text={resource.body} /></div></section>
      <div className="grid min-w-0 gap-4 @4xl:grid-cols-2">
        <HomeCheckHistory checks={resource.checks} />
        <section className="min-w-0 space-y-3"><h2 className="font-semibold">{t('home.res.uses')}</h2>{!resource.uses.length && <p className="text-vp-sm text-ink-2">{t('home.res.noUses')}</p>}<ul className="space-y-2">{resource.uses.map((use, index) => <li key={index} className="min-w-0 space-y-2 rounded-vp border border-hairline p-3 text-vp-sm"><div className="flex flex-wrap items-center gap-2"><span>{t(`home.res.purpose.${use.purpose}`)}</span><HomeTime at={use.at} /></div><div className="flex flex-wrap gap-2">{use.projectId && <a className="text-accent underline" href={homeProjectLink({ projectId: use.projectId, tab: 'sessions' })} onClick={onNavigate}>{safeText(use.projectId)}</a>}{use.sessionId && <a className="vp-control" href={panelOpeningSession(use.sessionId)}>{t('home.openTerminal')}</a>}</div></li>)}</ul></section>
      </div>
      <button type="button" className="vp-control home-wrap-control" disabled={busy} onClick={async () => {
        if (await run(async () => {
          if (!await askConfirm({ title: t('home.res.delete'), body: t('home.res.deleteBody', { title: safeText(resource.title) }), confirm: t('home.remove'), cancel: t('home.cancel'), destructive: true })) return false
          await homeApi.deleteResource(resource.id, resource.rev)
        })) onGo(HOME_RESOURCES_PATH)
      }}><Trash2 size={14} />{t('home.res.delete')}</button>
    </>}
    {editing && <HomeResourceEditor resource={editing} projects={projects} aliases={aliases} busy={busy} onClose={() => setEditing(null)} onSave={(fields) => run(() => homeApi.patchResource(editing.id, { ...fields, rev: editing.rev }))} />}
    {secrets && <HomeResourceSecrets resource={secrets} onChanged={changed} onClose={() => setSecrets(null)} />}
  </div>
}
