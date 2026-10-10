import { useCallback, useState, type MouseEvent } from 'react'
import { CheckSquare, FileText, Info, MessageSquare, RefreshCw, Terminal } from 'lucide-react'
import { t } from '../../i18n'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { homeApi, type HomeFieldSettings, type HomeProject, type HomeSuggestion } from '../../protocol/home'
import { panelOpeningSession, type HomeSelection, type HomeTab } from '../../routes'
import { safeText } from '../text'
import { showToast } from '../toasts'
import { changeHomeTaskFields, confirmHomeStatus } from './actions'
import type { HomeViewState } from './board'
import { HomeChat } from './HomeChat'
import { HomeField } from './HomeField'
import { HomeTable } from './HomeTable'
import { HomeReports } from './HomeReports'
import { HomeSessions } from './HomeSessions'
import { useHomeResource } from './useHomeResource'
import { useHomeMutation } from './useHomeMutation'

const tabs = [['chat', MessageSquare], ['tasks', CheckSquare], ['reports', FileText], ['sessions', Terminal], ['info', Info]] as const

export function HomeProjectPage({ selection, settings, state, onState, onTab, onThread, onChanged, onNavigate, returnSearch }: {
  selection: HomeSelection
  settings: HomeFieldSettings | null
  state: HomeViewState
  onState: (state: HomeViewState) => void
  onTab: (tab: HomeTab) => void
  onThread: (thread: string) => void
  onChanged: () => Promise<unknown> | void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  returnSearch?: string
}) {
  const { projectId, taskId, reportFile } = selection
  const wide = useMediaQuery('(min-width: 768px)')
  const load = useCallback((signal: AbortSignal) => homeApi.project(projectId, signal), [projectId])
  const detail = useHomeResource(load)
  const [createdSession, setCreatedSession] = useState('')
  const [chatRevision, setChatRevision] = useState(0)
  const changed = async () => { await detail.refresh(); await onChanged(); setChatRevision((old) => old + 1) }
  const { busy, run } = useHomeMutation(changed)
  const data = detail.data
  const tab = selection.tab ?? 'chat'
  const rightTab = tab === 'chat' ? 'tasks' : tab
  const visibleTabs = wide ? tabs.filter(([id]) => id !== 'chat') : tabs
  const activeTab = wide ? rightTab : tab
  const createSession = async (session: { name?: string; profileId?: string }) => {
    const created = await homeApi.createSession(projectId, session)
    setCreatedSession(created.sessionId)
  }
  const suggestion = (item: HomeSuggestion) => run(async () => {
    if (!data) return false
    switch (item.type) {
      case 'create_task':
        if ((item.task.status === 'done' || item.task.status === 'cancelled') && !await confirmHomeStatus(item.task.title, item.task.status)) return false
        await homeApi.createTask(projectId, item.task)
        break
      case 'create_session': await createSession({ name: item.name }); break
      case 'set_project': await homeApi.patchMeta(projectId, { ...item.fields, rev: data.project.metaRev }); break
      case 'reply_report': {
        const report = data.reports.find((report) => report.file === item.file)
        if (!report) throw new Error(t('home.reportMissing'))
        await homeApi.replyReport(projectId, report.file, item.text, report.rev)
        break
      }
      case 'set_fields':
      case 'set_status': {
        const task = data.tasks.find((task) => task.id === item.taskId)
        if (!task) throw new Error(t('home.taskMissing'))
        return changeHomeTaskFields(projectId, task, item.type === 'set_fields' ? item.fields : { status: item.status })
      }
    }
  })
  const nav = <nav className="home-project-tabs vp-safe-bottom shrink-0 border-t border-hairline bg-surface p-2 md:border-t-0 md:border-b" aria-label={t('home.navigation')}>
    <div className="vp-segmented" role="tablist">{visibleTabs.map(([id, Icon], index) => <button key={id} id={`home-tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls={`home-panel-${id}`} tabIndex={activeTab === id ? 0 : -1} className="vp-tab h-auto flex-col gap-1 px-1 py-2 text-vp-xs" onClick={() => onTab(id)} onKeyDown={(event) => {
      const next = event.key === 'ArrowRight' ? (index + 1) % visibleTabs.length : event.key === 'ArrowLeft' ? (index + visibleTabs.length - 1) % visibleTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : null
      if (next !== null) { event.preventDefault(); onTab(visibleTabs[next][0]); document.getElementById(`home-tab-${visibleTabs[next][0]}`)?.focus() }
    }}><Icon size={16} /><span>{t(`home.tab.${id}`)}</span></button>)}</div>
  </nav>

  return <main className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="home-project-page">
    <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2"><h1 className="min-w-0 flex-1 truncate text-vp-md font-semibold">{safeText(projectId)}{data?.project.aliases.length ? <span className="ml-2 text-vp-xs font-normal text-ink-2">{safeText(data.project.aliases.join(' · '))}</span> : null}</h1><button type="button" className="vp-control" disabled={detail.loading} onClick={() => void detail.refresh()} title={t('home.refresh')}><RefreshCw size={15} className={detail.loading ? 'animate-spin' : ''} /></button></div>
    {detail.error && <p role="alert" className="shrink-0 px-4 py-2 text-vp-sm">{safeText(detail.error)}</p>}
    {createdSession && <p role="status" className="shrink-0 px-4 py-2 text-vp-sm">{t('home.sessionCreated')} <a className="vp-control" href={panelOpeningSession(createdSession)}>{t('home.openTerminal')}</a></p>}
    {!data && detail.loading && <p role="status" className="p-4">{t('home.loading')}</p>}
    {data && <div className="flex min-h-0 min-w-0 flex-1">
      <div id="home-panel-chat" role={!wide ? 'tabpanel' : undefined} aria-label={t('home.tab.chat')} className={`${wide || tab === 'chat' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-[3] flex-col`}><HomeChat projectId={projectId} thread={selection.thread ?? 'main'} onThread={onThread} busy={busy} onSuggestion={suggestion} revision={chatRevision} /></div>
      <div className={`${wide || tab !== 'chat' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-[2] flex-col border-hairline md:border-l`}>
        {wide && nav}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
          <div id="home-panel-tasks" role="tabpanel" aria-labelledby="home-tab-tasks" hidden={rightTab !== 'tasks'}>{rightTab === 'tasks' && <HomeTable projects={[data.project]} tasks={data.tasks.map((task) => ({ ...task, projectId }))} todos={data.todos} settings={settings} state={state} onState={onState} onChanged={changed} onNavigate={onNavigate} projectId={projectId} target={taskId} returnSearch={returnSearch} />}</div>
          <div id="home-panel-reports" role="tabpanel" aria-labelledby="home-tab-reports" hidden={rightTab !== 'reports'}><HomeReports projectId={projectId} reports={data.reports} target={reportFile} active={rightTab === 'reports'} busy={busy} onNavigate={onNavigate} returnSearch={returnSearch} onReply={(report, text) => run(async () => {
            await homeApi.replyReport(projectId, report.file, text, report.rev)
            showToast({ kind: 'success', key: 'home.replySaved' })
          })} /></div>
          <div id="home-panel-sessions" role="tabpanel" aria-labelledby="home-tab-sessions" hidden={rightTab !== 'sessions'}><HomeSessions project={data.project} busy={busy} onCreate={(session) => run(() => createSession(session))} /></div>
          <div id="home-panel-info" role="tabpanel" aria-labelledby="home-tab-info" hidden={rightTab !== 'info'}><ProjectInfo project={data.project} settings={settings} busy={busy} onSave={(patch) => run(() => homeApi.patchMeta(projectId, { ...patch, rev: data.project.metaRev }))} /></div>
        </div>
      </div>
    </div>}
    {!wide && nav}
  </main>
}

function ProjectInfo({ project, settings, busy, onSave }: { project: HomeProject; settings: HomeFieldSettings | null; busy: boolean; onSave: (patch: Partial<HomeProject['meta']>) => Promise<boolean> }) {
  return <section className="space-y-4 text-vp-sm">
    <div><h2 className="font-semibold">{t('home.table.goal')}</h2><p className="mt-2 text-ink-2">{safeText(project.goal) || t('home.noGoal')}</p></div>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
      {(['labels', 'priority', 'phase', 'owner'] as const).map((key) => <div key={key} className="contents"><dt className="py-1 text-ink-2">{t(`home.table.${key}`)}</dt><dd className="min-w-0"><HomeField label={t(`home.table.${key}`)} value={project.meta[key]} options={key === 'owner' ? undefined : settings?.fields.project[key].options} disabled={busy || (key !== 'owner' && !settings)} onSave={(value) => onSave({ [key]: value })} /></dd></div>)}
    </dl>
    <button type="button" className="vp-control" disabled={busy} onClick={() => void onSave({ pinned: !project.meta.pinned })}>{t(project.meta.pinned ? 'home.unpin' : 'home.pin')}</button>
    {project.activeDocs.length > 0 && <div><h2 className="font-semibold">{t('home.activeDocs')}</h2><ul className="mt-2 space-y-2">{project.activeDocs.map((doc, index) => <li key={index}>{safeText(doc.title)}<p className="text-vp-xs text-ink-2">{safeText(doc.href)}</p></li>)}</ul></div>}
    {project.lastVerified && <p>{t('home.lastVerified', { commit: safeText(project.lastVerified) })}</p>}
    {project.blockers.length > 0 && <div><h2 className="font-semibold">{t('home.blockers')}</h2><ul className="mt-2 space-y-2">{project.blockers.map((blocker, index) => <li key={index}>{safeText(blocker)}</li>)}</ul></div>}
  </section>
}
