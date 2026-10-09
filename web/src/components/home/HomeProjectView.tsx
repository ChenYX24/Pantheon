import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { CheckSquare, FileText, MessageSquare, RefreshCw, Terminal, X } from 'lucide-react'
import { t } from '../../i18n'
import { HomeAPIError, homeApi, type HomeCreateSession, type HomeCreateTask, type HomeSuggestion, type HomeTask, type HomeTaskStatus } from '../../protocol/home'
import { panelOpeningSession } from '../../routes'
import { safeText } from '../text'
import { HomeChat } from './HomeChat'
import { HomeTasks } from './HomeTasks'
import { HomeReports } from './HomeReports'
import { HomeSessions } from './HomeSessions'
import type { HomeSelection } from './helpers'
import { useHomeResource } from './useHomeResource'
import { changeHomeTaskStatus, confirmHomeStatus } from './actions'

const tabs = [
  ['chat', MessageSquare], ['tasks', CheckSquare], ['reports', FileText], ['sessions', Terminal],
] as const
type Tab = typeof tabs[number][0]

export function HomeProjectView({ selection, onClose, onChanged, onNavigate }: {
  selection: HomeSelection
  onClose: () => void
  onChanged: () => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const { projectId, taskId, reportFile } = selection
  const load = useCallback((signal: AbortSignal) => homeApi.project(projectId, signal), [projectId])
  const { data, error: readError, loading, refresh } = useHomeResource(load)
  const [tab, setTab] = useState<Tab>(reportFile ? 'reports' : taskId ? 'tasks' : 'chat')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [createdSession, setCreatedSession] = useState('')
  const sheet = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => { setTab(reportFile ? 'reports' : taskId ? 'tasks' : 'chat') }, [taskId, reportFile])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => { previous?.focus() }
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || document.querySelector('[data-vp-modal="confirm"], [data-vp-modal="launch"]')) return
      if (event.key === 'Escape' && !locked.current) { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const focusable = [...(sheet.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const run = async (action: () => Promise<unknown>) => {
    if (locked.current) return false
    locked.current = true
    setBusy(true); setError('')
    try {
      if (await action() === false) return false
      await refresh()
      onChanged()
      return true
    } catch (e) {
      // A conflict refreshes the displayed revision, but never repeats the
      // write or clears the draft that was rejected.
      if (e instanceof HomeAPIError && e.status === 409) await refresh()
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const changeStatus = (task: HomeTask, status: HomeTaskStatus) => run(() => changeHomeTaskStatus(projectId, task, status))
  const createTask = (task: HomeCreateTask) => run(async () => {
    if ((task.status === 'done' || task.status === 'cancelled') && !(await confirmHomeStatus(task.title, task.status))) return false
    await homeApi.createTask(projectId, task)
  })
  const createSession = (session: HomeCreateSession) => run(async () => {
    const result = await homeApi.createSession(projectId, session)
    setCreatedSession(result.sessionId)
  })
  const applySuggestion = (suggestion: HomeSuggestion): Promise<boolean> => {
    if (suggestion.type === 'create_task') return createTask(suggestion.task)
    if (suggestion.type === 'create_session') return createSession({ name: suggestion.name })
    const task = data?.tasks.find((item) => item.id === suggestion.taskId)
    if (!task) { setError(t('home.taskMissing')); return Promise.resolve(false) }
    return changeStatus(task, suggestion.status)
  }

  return <div className="fixed inset-0 z-30 flex justify-end bg-black/40" data-testid="home-project-view" onClick={() => { if (!busy) onClose() }}>
    <section ref={sheet} role="dialog" aria-modal="true" aria-labelledby="home-project-title" data-vp-modal="home" className="@container flex h-full w-full min-w-0 flex-col border-l border-hairline bg-bg text-ink shadow-xl md:max-w-[min(48rem,85vw)] [overflow-wrap:anywhere]" onClick={(event) => event.stopPropagation()}>
      <header className="vp-safe-pad-top flex shrink-0 items-start gap-2 border-b border-hairline bg-surface p-4">
        <div className="min-w-0 flex-1"><h2 id="home-project-title" className="text-vp-lg font-semibold">{safeText(projectId)}</h2>{data?.project.aliases.length ? <p className="mt-1 text-vp-sm text-ink-2">{safeText(data.project.aliases.join(' · '))}</p> : null}</div>
        <button type="button" className="vp-control" disabled={loading} onClick={() => void refresh()} title={t('home.refresh')}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        <button ref={close} type="button" className="vp-control" disabled={busy} onClick={onClose} title={t('home.closeProject')}><X size={18} /></button>
      </header>
      <nav className="grid shrink-0 grid-cols-4 gap-1 border-b border-hairline bg-surface px-2 py-2" aria-label={t('home.navigation')} role="tablist">
        {tabs.map(([id, Icon], i) => <button key={id} id={`home-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`home-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
          if (next === null) return
          event.preventDefault(); setTab(tabs[next][0]); document.getElementById(`home-tab-${tabs[next][0]}`)?.focus()
        }} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-vp px-1 py-2 text-vp-sm @lg:flex-row ${tab === id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2'}`}><Icon size={16} className="shrink-0" /><span>{t(`home.tab.${id}`)}</span></button>)}
      </nav>
      <div className="vp-safe-bottom min-h-0 min-w-0 flex-1 overflow-y-auto p-4 [--vp-safe-pad:2rem]">
        {(error || readError) && <p role="alert" className="mb-4 rounded-vp border border-hairline bg-surface p-3">{safeText(error || readError)}</p>}
        {createdSession && <p role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-vp border border-hairline bg-surface p-3 text-vp-sm">{t('home.sessionCreated')}<a className="vp-control" href={panelOpeningSession(createdSession)}>{t('home.openTerminal')}</a></p>}
        {!data && loading && <p role="status">{t('home.loading')}</p>}
        {data && <>
          <p className="mb-4 text-vp-base text-ink-2">{safeText(data.project.goal) || t('home.noGoal')}</p>
          {data.project.blockers.length > 0 && <div className="mb-4 rounded-vp border border-hairline bg-surface p-3 text-vp-sm"><h3 className="font-semibold">{t('home.blockers')}</h3><ul className="mt-1 space-y-1">{data.project.blockers.map((blocker, i) => <li key={i}>{safeText(blocker)}</li>)}</ul></div>}
          <div id="home-panel-chat" role="tabpanel" aria-labelledby="home-tab-chat" hidden={tab !== 'chat'}><HomeChat projectId={projectId} busy={busy} onSend={(message, executor) => run(() => homeApi.sendMessage(projectId, message, executor))} onSuggestion={applySuggestion} /></div>
          <div id="home-panel-tasks" role="tabpanel" aria-labelledby="home-tab-tasks" hidden={tab !== 'tasks'}><HomeTasks tasks={data.tasks} target={taskId} active={tab === 'tasks'} busy={busy} onStatus={changeStatus} onCreate={createTask} /></div>
          <div id="home-panel-reports" role="tabpanel" aria-labelledby="home-tab-reports" hidden={tab !== 'reports'}><HomeReports projectId={projectId} reports={data.reports} target={reportFile} active={tab === 'reports'} onNavigate={onNavigate} /></div>
          <div id="home-panel-sessions" role="tabpanel" aria-labelledby="home-tab-sessions" hidden={tab !== 'sessions'}><HomeSessions project={data.project} busy={busy} onCreate={createSession} /></div>
          {data.project.lastVerified && <p className="mt-5 border-t border-hairline pt-3 text-vp-xs text-ink-3">{t('home.lastVerified', { commit: safeText(data.project.lastVerified) })}</p>}
        </>}
      </div>
    </section>
  </div>
}
