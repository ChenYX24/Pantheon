import { appURL } from '../basePath'
import { ConfirmDialog } from './ConfirmDialog'
import { LanguageSwitch } from './LanguageSwitch'
import { confirmProjectAction } from './projectConfirm'
import { t, useLang } from '../i18n'
import { workflowRequest as request } from '../protocol/workflow'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, CircleDot, Layers3, MessageSquare, RefreshCw, ShieldCheck, Workflow } from 'lucide-react'
import { api } from '../protocol/api'
import type { Project, Session } from '../protocol/wire'
import { PANEL_PATH, panelOpeningSession } from '../routes'
import { ProjectBoard } from './ProjectBoard'
import { CapabilityInventory, StageNotifications, ProposalChanges } from './ProjectWorkflowDetails'
import type { Assignment, Board } from './ProjectBoard'
import { applyTheme, loadTheme } from './theme'

interface Executor { harness: string; model: string; installed: boolean; source: string }
interface Message { id: string; role: string; body: string; proposal?: Board; createdAt: number }
interface Capability { id: string; name: string; kind: string; content: string; revision: number; state: string }
interface Run { id: string; taskId: string; stageId: string; state: string; sessionId: string; workspace: string; summary: string; attempts: number; switched: boolean; costUsd: number | null; costKind: string }
interface Approval { id: string; stageId: string; state: string; expiresAt: number }
interface View { approvals: Approval[]; messages: Message[]; runs: Run[]; capabilities: Capability[]; events: { id: number; kind: string; body: string; createdAt: number }[] }
const input = 'w-full min-w-0 rounded-vp border border-hairline bg-surface px-3 py-2 text-ink'

const tabs = [['overview', 'pm.tab.overview'], ['chat', 'pm.tab.chat'], ['board', 'pm.tab.board'], ['runs', 'pm.tab.runs'], ['skills', 'pm.tab.skills']] as const
type Tab = typeof tabs[number][0]

export function ProjectWorkspace({ onSignOut }: { onSignOut: () => void }) {
  const lang = useLang()
  useEffect(() => { document.title = `Parthenon · ${t('pm.workspace')}` }, [lang])
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('project') || '')
  const selection = useRef(selected)
  useEffect(() => { selection.current = selected }, [selected])
  const [tab, setTab] = useState<Tab>('overview')
  const [board, setBoard] = useState<Board | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [executors, setExecutors] = useState<Executor[]>([])
  const [agent, setAgent] = useState<Assignment>({ harness: 'claude', model: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [boardDirty, setBoardDirty] = useState(false)
  const [execution, setExecution] = useState(false)
  const [capability, setCapability] = useState({ name: '', kind: 'skill', content: '' })
  useEffect(() => {
    applyTheme(loadTheme())
    void api.state().then((state) => { setProjects(state.projects); setSessions(state.sessions); setSelected((id) => id || state.projects[0]?.id || '') }).catch((e: unknown) => setError(String(e)))
    void request<{ executionEnabled: boolean }>('/api/workflow/settings').then((v) => setExecution(v.executionEnabled)).catch((e: unknown) => setError(String(e)))
    void request<Executor[]>('/api/workflow/executors').then((list) => {
      setExecutors(list)
      const first = list.find((e) => e.harness === 'claude' && e.installed && e.model) ?? list.find((e) => e.installed && e.model)
      if (first) setAgent({ harness: first.harness, model: first.model })
    }).catch((e: unknown) => setError(String(e)))
  }, [])
  const refresh = useCallback(async () => {
    if (!selected) return
    const [b, v] = await Promise.all([request<Board>(`/api/projects/${selected}/board`), request<View>(`/api/projects/${selected}/workflow`)])
    if (selection.current === selected) { setBoard(b); setView(v) }
  }, [selected])
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (!selected) return
      try {
        const [b, v] = await Promise.all([request<Board>(`/api/projects/${selected}/board`), request<View>(`/api/projects/${selected}/workflow`)])
        if (!cancelled) { setBoard(b); setView(v) }
      } catch (e) { if (!cancelled) setError(String(e)) }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [selected])
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn(); await refresh() } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const project = projects.find((p) => p.id === selected)
  const tasks = board?.tasks ?? []
  const done = tasks.filter((t) => t.status === 'done').length
  const modelMap = Object.fromEntries(executors.map((e) => [e.harness, e.model]))
  const discard = async () => !(boardDirty || capability.content || message) || await confirmProjectAction(t('pm.discardProject'), true)
  const changeProject = async (id: string) => { if (!(await discard())) return; selection.current = id; setBoardDirty(false); setCapability({ name: '', kind: 'skill', content: '' }); setSelected(id); setBoard(null); setView(null); setError(''); setMessage(''); history.replaceState(null, '', `?project=${encodeURIComponent(id)}`) }

  return <div className="h-full overflow-y-auto bg-bg text-ink">
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-hairline bg-surface px-4 py-3">
      <a className="vp-control" href={PANEL_PATH} aria-label={t('pm.back')} onClick={async (event) => { event.preventDefault(); if (await discard()) location.assign(PANEL_PATH) }}><ArrowLeft size={17} /></a>
      <Layers3 size={21} /><span className="text-vp-md font-semibold tracking-tight">Parthenon</span><span className="text-vp-base text-ink-2">{t('pm.workspace')}</span>
      <button className="vp-control ml-auto" type="button" onClick={() => void act(refresh)} aria-label={t('pm.refresh')}><RefreshCw size={16} /></button>
      <button className="vp-control" type="button" onClick={async () => { if (await discard()) onSignOut() }}>{t('pm.signOut')}</button>
      <LanguageSwitch testid="projects" />
    </header>
    <main className="@container mx-auto max-w-[1500px] p-4">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="w-full max-w-md text-vp-base">{t('pm.currentProject')}<select aria-label={t('pm.currentProject')} className={`${input} mt-1`} value={selected} disabled={busy} onChange={(e) => changeProject(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <p className="min-w-0 break-all text-vp-xs text-ink-2">{project?.path}</p>
      </div>
      {error && <div role="alert" className="mb-4 rounded-vp border border-hairline bg-surface p-3">{error}</div>}
      {!projects.length && <p>{t('pm.startProject')}</p>}
      <nav className="mb-5 flex flex-wrap gap-2" aria-label={t('pm.navigation')}>{tabs.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} className={`rounded-vp border px-3 py-2 text-vp-base ${tab === id ? 'border-ink bg-surface font-semibold' : 'border-hairline text-ink-2'}`} onClick={async () => { if (id === tab || !boardDirty || await confirmProjectAction(t('pm.discardTab'), true)) { setBoardDirty(false); setTab(id) } }}>{t(label)}</button>)}</nav>
      {tab === 'overview' && board && <>
        <section className="mb-4 rounded-vp-lg border border-hairline bg-surface p-5"><h1 className="mb-2 text-vp-lg font-semibold">{project?.name}</h1><p className="whitespace-pre-wrap text-ink-2">{board.goal || t('pm.emptyGoal')}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 @2xl:grid-cols-4">{[[`${done}/${tasks.length}`, t('pm.accepted')], [tasks.filter((t) => t.status === 'blocked').length, t('pm.blocked')], [view?.runs.filter((r) => ['claimed', 'running', 'stopping'].includes(r.state)).length ?? 0, t('pm.activeRuns')], [board.planVersion || board.rev, t('pm.planVersion')]].map(([value, label]) => <div key={label} className="rounded-vp border border-hairline p-3"><p className="text-vp-lg font-semibold">{value}</p><p className="text-vp-base text-ink-2">{label}</p></div>)}</div>
        </section>
        <div className="grid gap-4 @3xl:grid-cols-2">{board.stages.map((stage) => {
          const approval = view?.approvals.find((a) => a.stageId === stage.id && a.state === 'approved' && a.expiresAt * 1000 > Date.now())
          return <section key={stage.id} className="rounded-vp-lg border border-hairline bg-surface p-4"><h2 className="font-semibold">{stage.id} · {stage.title}</h2><p className="my-2 text-vp-base text-ink-2">{stage.reason}</p><p className="break-all text-vp-base">{t('pm.primaryModel', { executor: stage.primary.harness, model: stage.primary.model })}<br />{t('pm.secondaryModel', { executor: stage.secondary.harness, model: stage.secondary.model })}</p><p className="my-3 text-vp-base">{t('pm.budget', { stage: stage.budgetMinutes, attempt: stage.attemptMinutes, max: stage.maxAttempts })}</p>
            <p className="mb-2 text-vp-xs text-ink-2">{execution ? t('pm.executionOn') : t('pm.executionOff')}{t('pm.confirmScope')}</p>
            <div className="flex gap-2"><button type="button" className="vp-control" disabled={busy || !!approval} onClick={async () => {
              const commands = board.tasks.filter((t) => t.phase === stage.id).flatMap((t) => t.verify || []).join('\n')
              if (await confirmProjectAction(t('pm.approveBody', { stage: stage.title, rev: board.rev, commands: commands || t('pm.noChecks') }))) void act(() => request(`/api/projects/${selected}/stages/${stage.id}/approve`, 'POST', { rev: board.rev }))
            }}><CheckCircle2 size={15} />{approval ? t('pm.approved') : t('pm.approveStage')}</button><button type="button" className="vp-control" disabled={busy} onClick={() => void act(() => request(`/api/projects/${selected}/stages/${stage.id}/pause`, 'POST', {}))}>{t('pm.pause')}</button></div>
          </section>
        })}</div>
        <StageNotifications projectId={selected} board={board} />
        <section className="mt-5"><h2 className="mb-3 font-semibold">{t('pm.recentActivity')}</h2>{view?.events.slice(0, 10).map((event) => <p className="mb-2 break-words text-vp-base text-ink-2" key={event.id}>{new Date(event.createdAt * 1000).toLocaleString()} · {event.body}</p>)}</section>
      </>}
      {tab === 'chat' && <section className="rounded-vp-lg border border-hairline bg-surface p-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold"><MessageSquare size={18} />{t('pm.manager')}</h2><p className="mb-4 text-vp-base text-ink-2">{t('pm.managerHelp')}</p>
        <div className="mb-4 max-h-[50dvh] space-y-3 overflow-y-auto">{view?.messages.map((m) => <article key={m.id} className={`rounded-vp border border-hairline p-3 ${m.role === 'user' ? 'ml-4' : 'mr-4'}`}><strong className="text-vp-xs text-ink-2">{m.role === 'user' ? t('pm.you') : m.role === 'assistant' ? t('pm.manager') : t('pm.runtimeNote')}</strong><p className="mt-1 whitespace-pre-wrap break-words text-vp-base">{m.body}</p>{m.proposal && <details className="mt-3"><summary>{t('pm.proposalCount', { count: m.proposal.tasks.length })}</summary><p className="my-2 text-vp-base">{t('pm.proposalGoal', { goal: m.proposal.goal })}</p><ProposalChanges current={board} proposed={m.proposal} /><pre className="max-h-60 overflow-auto rounded-md border border-hairline p-2 text-vp-xs">{JSON.stringify(m.proposal, null, 2)}</pre><button type="button" className="vp-control mt-2" disabled={busy} onClick={async () => {
          if (await confirmProjectAction(t('pm.applyPlanBody'))) void act(async () => { await request(`/api/projects/${selected}/board`, 'PUT', m.proposal); setRevision((n) => n + 1) })
        }}>{t('pm.applyPlan')}</button></details>}</article>)}</div>
        <div className="mb-3 grid gap-2 @2xl:grid-cols-2"><label>{t('pm.managerExecutor')}<select className={input} value={agent.harness} onChange={(e) => setAgent({ harness: e.target.value, model: modelMap[e.target.value] || '' })}>{executors.map((e) => <option key={e.harness} value={e.harness}>{e.harness}{e.installed ? '' : t('pm.notInstalled')}</option>)}</select></label><label>{t('pm.model')}<input className={input} value={agent.model} onChange={(e) => setAgent({ ...agent, model: e.target.value })} /></label></div>
        <form onSubmit={(e) => { e.preventDefault(); const text = message; void act(async () => { await request(`/api/projects/${selected}/discussion`, 'POST', { message: text, executor: agent }); setMessage('') }) }}><textarea aria-label={t('pm.message')} className={input} rows={4} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} placeholder={t('pm.messagePlaceholder')} /><button type="submit" className="vp-control mt-2" disabled={busy || !message.trim() || !agent.model || !selected}>{busy ? t('pm.processing') : t('pm.send')}</button></form>
      </section>}
      {tab === 'board' && project && <ProjectBoard key={`${selected}-${revision}`} embedded projects={[project]} sessions={sessions} models={modelMap} onClose={() => setTab('overview')} onSaved={() => void refresh()} onDirtyChange={setBoardDirty} />}
      {tab === 'runs' && <section><div className="mb-4 flex flex-wrap gap-2"><h2 className="mr-auto flex items-center gap-2 font-semibold"><Workflow size={18} />{t('pm.handoffTitle')}</h2><a className="vp-control" href={appURL(`/api/projects/${selected}/handoff`)} target="_blank" rel="noreferrer">{t('pm.viewHandoff')}</a></div>{view?.runs.length === 0 && <p className="text-ink-2">{t('pm.noRuns')}</p>}{view?.runs.map((run) => <article key={run.id} className="mb-3 rounded-vp-lg border border-hairline bg-surface p-4"><h3 className="font-semibold">{run.taskId} · {run.state}</h3><p className="my-2 text-vp-base text-ink-2">{t('pm.runDetails', { attempts: run.attempts, executor: run.switched ? t('pm.fallback') : t('pm.primary'), cost: run.costUsd === null ? t('pm.unknown') : t('pm.cost', { amount: run.costUsd, kind: run.costKind }) })}</p><p className="break-all text-vp-xs text-ink-2">{run.workspace}</p><p className="my-3 whitespace-pre-wrap break-words text-vp-base">{run.summary}</p>{run.sessionId && <a className="vp-control" href={panelOpeningSession(run.sessionId)}>{t('pm.openSession')}</a>}</article>)}</section>}
      {tab === 'skills' && <><CapabilityInventory projectId={selected} onDraft={setCapability} /><section className="grid gap-4 @3xl:grid-cols-2"><div className="rounded-vp-lg border border-hairline bg-surface p-4"><h2 className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck size={18} />{t('pm.capabilityDraft')}</h2><p className="mb-4 text-vp-base text-ink-2">{t('pm.capabilityHelp')}</p><form onSubmit={(e) => { e.preventDefault(); void act(async () => { await request(`/api/projects/${selected}/capabilities`, 'POST', capability); setCapability({ ...capability, content: '' }) }) }}><label className="mb-2 block">{t('pm.name')}<input className={input} required value={capability.name} onChange={(e) => setCapability({ ...capability, name: e.target.value })} /></label><label className="mb-2 block">{t('pm.capabilityKind')}<select className={input} value={capability.kind} onChange={(e) => setCapability({ ...capability, kind: e.target.value })}>{[['skill', 'Skill'], ['rule', t('pm.rule')], ['mcp', t('pm.mcp')], ['handoff', t('pm.handoff')], ['remote', t('pm.remote')]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{t('pm.content')}<textarea className={input} required rows={10} value={capability.content} onChange={(e) => setCapability({ ...capability, content: e.target.value })} /></label><button type="submit" className="vp-control mt-3" disabled={busy}>{t('pm.saveCapability')}</button></form></div><div>{view?.capabilities.map((c) => <article key={c.id} className="mb-3 rounded-vp-lg border border-hairline bg-surface p-4"><h3 className="flex items-center gap-2 font-semibold"><CircleDot size={16} />{c.name} · v{c.revision}</h3><p className="my-2 text-vp-xs text-ink-2">{c.kind} · {c.state}</p><details><summary>{t('pm.viewContent')}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-vp-xs">{c.content}</pre></details>{c.state === 'draft' && <button className="vp-control mt-3" type="button" disabled={busy} onClick={async () => { if (await confirmProjectAction(t('pm.applyCapabilityBody'))) void act(() => request(`/api/projects/${selected}/capabilities/${c.id}/activate`, 'POST', { revision: c.revision })) }}>{t('pm.applyCapability')}</button>}<button className="vp-control mt-3" type="button" onClick={() => setCapability({ name: c.name, kind: c.kind, content: c.content })}>{t('pm.reviseCapability')}</button></article>)}</div></section></>}
    </main>
    <ConfirmDialog />
  </div>
}
