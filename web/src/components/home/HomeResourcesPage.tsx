import { useState, type MouseEvent } from 'react'
import { Download, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { t } from '../../i18n'
import { HOME_RESOURCE_KINDS, homeApi, type HomeProject, type HomeResource } from '../../protocol/home'
import { homeResourceLink } from '../../routes'
import { askConfirm } from '../ask'
import { safeText } from '../text'
import { HomeResourceCard } from './HomeResourceCard'
import { HomeResourceDetail } from './HomeResourceDetail'
import { HomeResourceEditor } from './HomeResourceEditor'
import { HomeResourceImport } from './HomeResourceImport'
import { HomeResourceSecrets } from './HomeResourceSecrets'
import { HomeServerOverview } from './HomeResourceStatus'
import { filterResources, type ResourceFilter } from './resources'
import { useHomeMutation } from './useHomeMutation'
import { useHomeResource } from './useHomeResource'

export function HomeResourcesPage({ resourceId, projects, projectError, onNavigate, onGo }: {
  resourceId?: string
  projects: HomeProject[]
  projectError: string
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  onGo: (path: string) => void
}) {
  const resources = useHomeResource(homeApi.resources)
  const servers = useHomeResource(homeApi.servers)
  const [kind, setKind] = useState<ResourceFilter>('all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState<'ssh' | 'profile' | null>(null)
  const [secrets, setSecrets] = useState<HomeResource | null>(null)
  const [checking, setChecking] = useState('')
  const changed = async () => { await resources.refresh(); await servers.refresh() }
  const mutation = useHomeMutation(changed)
  const list = filterResources(resources.data?.resources ?? [], kind, query)
  const check = async (resource: HomeResource) => {
    if (mutation.busy) return
    setChecking(resource.id)
    try { await mutation.run(() => homeApi.checkResource(resource.id)) } finally { setChecking('') }
  }
  return <main className="vp-safe-bottom min-h-0 min-w-0 flex-1 overflow-y-auto p-3 [--vp-safe-pad:2rem]" data-testid="home-resources-page">
    <div className="@container mx-auto max-w-[1500px] space-y-4 [overflow-wrap:anywhere]">
      {projectError && <p role="alert" className="text-vp-sm">{safeText(projectError)}</p>}
      {resourceId ? <HomeResourceDetail key={resourceId} id={resourceId} projects={projects} aliases={servers.data?.sshAliases ?? []} boardURL={servers.data?.board.url ?? ''} onChanged={changed} onNavigate={onNavigate} onGo={onGo} /> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-vp-lg font-semibold">{t('home.res.title')}</h1><button type="button" className="vp-control" title={t('home.refresh')} disabled={resources.loading || servers.loading} onClick={() => void changed()}><RefreshCw size={16} /></button></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="vp-control home-wrap-control" onClick={() => setCreating(true)}><Plus size={15} />{t('home.res.new')}</button><button type="button" className="vp-control home-wrap-control" disabled={!servers.data} onClick={() => setImporting('ssh')}><Download size={15} />{t('home.res.importSSH')}</button><button type="button" className="vp-control home-wrap-control" onClick={() => setImporting('profile')}><Download size={15} />{t('home.res.importProfile')}</button></div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('home.res.kind')}>{(['all', ...HOME_RESOURCE_KINDS] as const).map((value) => <button type="button" key={value} className="vp-control" aria-pressed={kind === value} onClick={() => setKind(value)}>{t(`home.res.kind.${value}`)}</button>)}</div>
        <label className="flex min-w-0 items-center gap-2"><Search size={16} className="shrink-0 text-ink-2" /><input className="home-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('home.res.search')} aria-label={t('home.res.search')} /></label>
        {(resources.error || servers.error) && <p role="alert" className="text-vp-sm">{safeText(resources.error || servers.error)}</p>}
        {!resources.data && resources.loading && <p role="status">{t('home.loading')}</p>}
        {(kind === 'all' || kind === 'server') && servers.data && <HomeServerOverview data={servers.data} />}
        {checking && <p role="status" className="text-vp-sm text-ink-2">{t('home.res.checking')} · {safeText(checking)}</p>}
        {resources.data && !list.length && <p className="rounded-vp border border-hairline bg-surface p-4 text-ink-2">{t(resources.data.resources.length ? 'home.noMatches' : 'home.res.empty')}</p>}
        <div className="grid min-w-0 gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">{list.map((resource) => <HomeResourceCard key={resource.id} resource={resource} boardURL={servers.data?.board.url ?? ''} busy={mutation.busy} onCheck={(resource) => void check(resource)} onSecrets={setSecrets} onNavigate={onNavigate} />)}</div>
        {!!resources.data?.orphans.length && <section className="space-y-3 rounded-vp border border-hairline bg-surface p-3"><h2 className="font-semibold">{t('home.res.orphans')}</h2><p className="text-vp-sm text-ink-2">{t('home.res.orphansHint')}</p>{resources.data.orphans.map((orphan) => <div key={orphan.resourceId} className="min-w-0 space-y-2"><h3 className="text-vp-sm">{safeText(orphan.resourceId)}</h3>{orphan.names.map((name) => <div key={name} className="flex flex-wrap items-center gap-2 text-vp-xs"><span>{safeText(name)}</span><button type="button" className="vp-control" disabled={mutation.busy} onClick={() => void mutation.run(async () => {
          if (!await askConfirm({ title: t('home.res.removeSecret'), body: `${safeText(orphan.resourceId)} · ${safeText(name)}`, confirm: t('home.remove'), cancel: t('home.cancel'), destructive: true })) return false
          await homeApi.deleteResourceSecret(orphan.resourceId, name)
        })}><Trash2 size={13} />{t('home.remove')}</button></div>)}</div>)}</section>}
        {!!resources.data?.warnings.length && <details className="rounded-vp border border-hairline bg-surface p-3 text-vp-sm"><summary className="cursor-pointer">{t('home.warnings', { count: resources.data.warnings.length })}</summary><ul className="mt-2 space-y-2">{resources.data.warnings.map((warning, index) => <li key={index}>{safeText(warning.file)}<p className="text-ink-2">{safeText(warning.message)}</p></li>)}</ul></details>}
      </>}
    </div>
    {creating && <HomeResourceEditor projects={projects} aliases={servers.data?.sshAliases ?? []} busy={mutation.busy} onClose={() => setCreating(false)} onSave={(fields) => mutation.run(async () => { const resource = await homeApi.createResource(fields); onGo(homeResourceLink(resource.id)) })} />}
    {importing && <HomeResourceImport mode={importing} aliases={servers.data?.sshAliases ?? []} resources={resources.data?.resources ?? []} onChanged={changed} onClose={() => setImporting(null)} />}
    {secrets && <HomeResourceSecrets resource={secrets} onChanged={changed} onClose={() => setSecrets(null)} />}
  </main>
}
