import { t, useLang } from '../i18n'
import { workflowRequest as request } from '../protocol/workflow'
import { useEffect, useRef, useState } from 'react'
import { confirmProjectAction } from './projectConfirm'
import type { Project, Session } from '../protocol/wire'

const TASK_STATES = [
  ['planned', 'pm.state.planned'], ['ready', 'pm.state.ready'], ['running', 'pm.state.running'],
  ['confirmation', 'pm.state.confirmation'], ['review', 'pm.state.review'], ['done', 'pm.state.done'], ['blocked', 'pm.state.blocked'],
] as const

export interface Task {
  id: string
  title: string
  status: typeof TASK_STATES[number][0]
  phase: string
  owner: string
  acceptance: string
  evidence: string
  sessionId: string
  dependsOn: string[]
  verify: string[]
}
export interface Assignment { harness: string; model: string }
export interface Stage { id: string; title: string; primary: Assignment; secondary: Assignment; reason: string; budgetMinutes: number; attemptMinutes: number; maxAttempts: number }
export interface Board { planVersion?: number; projectId: string; goal: string; stages: Stage[]; tasks: Task[]; rev: number }

const requestBoard = (projectId: string, board?: Board) => request<Board>(
  `/api/projects/${encodeURIComponent(projectId)}/board`, board ? 'PUT' : 'GET', board,
)

const field = 'w-full min-w-0 rounded-md border border-hairline bg-surface px-2 py-2 text-ink'

export function ProjectBoard({ projects, sessions, onClose, embedded = false, onSaved, onDirtyChange, models = {} }: {
  projects: Project[]; sessions: Session[]; onClose: () => void; embedded?: boolean; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void; models?: Record<string, string>
}) {
  useLang()
  const dialog = useRef<HTMLDialogElement>(null)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [board, setBoard] = useState<Board | null>(null)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [reload, setReload] = useState(0)
  const dirty = board !== null && JSON.stringify(board) !== saved
  const discard = async () => !dirty || await confirmProjectAction(t('pm.discardBoard'), true)

  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    let cancelled = false
    if (!projectId) return
    requestBoard(projectId).then((next) => {
      if (cancelled) return
      setBoard(next); setSaved(JSON.stringify(next)); setError('')
    }).catch((e: unknown) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [projectId, reload])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (id: string, patch: Partial<Task>) => setBoard((previous) => previous && ({
    ...previous, tasks: previous.tasks.map((task) => task.id === id ? { ...task, ...patch } : task),
  }))
  const save = async () => {
    if (!board || busy) return
    setBusy(true); setError('')
    try {
      const next = await requestBoard(projectId, board)
      setBoard(next); setSaved(JSON.stringify(next)); onSaved?.()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const tasks = board?.tasks ?? []
  const done = tasks.filter((task) => task.status === 'done').length
  const phases = [...new Set(tasks.map((task) => task.phase).filter(Boolean))]

  const content = <>
    <header className="mb-4 flex flex-wrap items-center gap-3">
      <h2 className="flex-1 text-vp-lg font-semibold">{t('pm.boardTitle')}</h2>
      {!embedded && <button type="button" className="vp-control" disabled={busy} onClick={async () => { if (await discard()) onClose() }}>{t('pm.close')}</button>}
    </header>
    <p className="mb-3 text-vp-base text-ink-2">{t('pm.boardHelp')}</p>
    <label className="mb-4 block">{t('pm.project')}
      <select aria-label={t('pm.project')} className={field} value={projectId} disabled={busy} onChange={async (event) => {
        const nextProject = event.target.value
        if (!(await discard())) return
        setProjectId(nextProject); setBoard(null); setSaved(''); setError(''); setPhase('')
      }}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>
    {projects.length === 0 && <p>{t('pm.addProject')}</p>}
    {error && <p role="alert" className="mb-3 rounded-md border border-hairline p-3">{error}</p>}
    {projectId && !board && <button type="button" className="vp-control" onClick={() => setReload((n) => n + 1)}>{t('pm.reload')}</button>}
    {board && <fieldset disabled={busy} className="min-w-0">
      <label className="block">{t('pm.goal')}<textarea aria-label={t('pm.goal')} className={field} maxLength={2000} value={board.goal} onChange={(event) => setBoard({ ...board, goal: event.target.value })} /></label>
      <div className="my-3 flex flex-wrap items-center gap-3">
        <span data-testid="board-progress">{t('pm.acceptedProgress', { done, total: tasks.length })}{tasks.length > 0 ? ` · ${Math.round(done / tasks.length * 100)}%` : ''}</span>
        <span>{t('pm.waitingProgress', { waiting: tasks.filter((task) => task.status === 'confirmation').length, blocked: tasks.filter((task) => task.status === 'blocked').length })}</span>
        <span className="text-ink-2">{dirty ? t('pm.unsaved') : t('pm.savedVersion', { rev: board.rev })}</span>
        <button type="button" className="vp-control" disabled={!dirty} onClick={() => void save()}>{busy ? t('pm.saving') : t('pm.saveBoard')}</button>
        <button type="button" className="vp-control" onClick={async () => { if (await discard()) { setBoard(null); setReload((n) => n + 1) } }}>{t('pm.reload')}</button>
        <button type="button" className="vp-control" disabled={tasks.length >= 300} onClick={() => setBoard({ ...board, tasks: [...tasks, {
          id: crypto.randomUUID(), title: t('pm.newTask'), status: 'planned', phase: phase || board.stages?.[0]?.id || 'P0', owner: '', acceptance: '', evidence: '', sessionId: '', dependsOn: [], verify: [],
        }] })}>{t('pm.addTask')}</button>
      </div>
      <div className="my-4 rounded-vp border border-hairline p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t('pm.stageModels')}</h3><button type="button" className="vp-control" onClick={() => {
          const id = `P${Date.now().toString(36)}`
          setBoard({ ...board, stages: [...(board.stages ?? []), { id, title: t('pm.newStage'), primary: { harness: 'codex', model: models.codex || '' }, secondary: { harness: 'claude', model: models.claude || '' }, reason: t('pm.modelReasonDefault'), budgetMinutes: 120, attemptMinutes: 30, maxAttempts: 3 }] })
        }}>{t('pm.addStage')}</button></div>
        {(board.stages ?? []).map((stage) => {
          const change = (patch: Partial<Stage>) => setBoard({ ...board, stages: board.stages.map((item) => item.id === stage.id ? { ...item, ...patch } : item) })
          return <section key={stage.id} className="mt-3 grid min-w-0 gap-2 border-t border-hairline pt-3 @3xl:grid-cols-2">
            <label>{t('pm.stageName', { id: stage.id })}<input className={field} value={stage.title} onChange={(event) => change({ title: event.target.value })} /></label>
            <label>{t('pm.reason')}<input className={field} value={stage.reason} onChange={(event) => change({ reason: event.target.value })} /></label>
            {(['primary', 'secondary'] as const).map((role) => <div key={role} className="grid min-w-0 grid-cols-2 gap-2">
              <label>{role === 'primary' ? t('pm.primary') : t('pm.secondary')}<select className={field} value={stage[role].harness} onChange={(event) => change({ [role]: { harness: event.target.value, model: models[event.target.value] || '' } })}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
              <label>{t('pm.model')}<input className={field} value={stage[role].model} placeholder={t('pm.modelPlaceholder')} onChange={(event) => change({ [role]: { ...stage[role], model: event.target.value } })} /></label>
            </div>)}
            <label>{t('pm.maxAttempts')}<input type="number" min="1" max="3" className={field} value={stage.maxAttempts} onChange={(event) => change({ maxAttempts: Number(event.target.value) })} /></label>
            <label>{t('pm.stageMinutes')}<input type="number" min="1" max="1440" className={field} value={stage.budgetMinutes} onChange={(event) => change({ budgetMinutes: Number(event.target.value) })} /></label>
            <label>{t('pm.attemptMinutes')}<input type="number" min="1" max={stage.budgetMinutes} className={field} value={stage.attemptMinutes} onChange={(event) => change({ attemptMinutes: Number(event.target.value) })} /></label>
          </section>
        })}
      </div>
      <label className="mb-3 block">{t('pm.filterStage')}<select aria-label={t('pm.filterStage')} className={field} value={phase} onChange={(event) => setPhase(event.target.value)}>
        <option value="">{t('pm.allStages')}</option>{phases.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <div className="grid min-w-0 grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {TASK_STATES.map(([status, label]) => {
          const column = tasks.filter((task) => task.status === status && (!phase || task.phase === phase))
          return <section key={status} className="min-w-0 rounded-vp border border-hairline p-3">
            <h3 className="mb-3 font-semibold">{t(label)} · {column.length}</h3>
            {column.length === 0 && <p className="text-vp-base text-ink-2">{t('pm.noTasks')}</p>}
            {column.map((task) => <article key={task.id} className="mb-3 min-w-0 rounded-md border border-hairline p-3">
              <label className="block">{t('pm.task')}<input aria-label={t('pm.taskTitle')} className={field} maxLength={120} value={task.title} onChange={(event) => update(task.id, { title: event.target.value })} /></label>
              <div className="my-2 grid grid-cols-2 gap-2">
                <label>{t('pm.stage')}{board.stages?.length ? <select className={field} value={task.phase} onChange={(event) => update(task.id, { phase: event.target.value })}>{board.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select> : <input className={field} value={task.phase} onChange={(event) => update(task.id, { phase: event.target.value })} />}</label>
                <label>{t('pm.owner')}<input className={field} maxLength={48} value={task.owner} placeholder={t('pm.ownerPlaceholder')} onChange={(event) => update(task.id, { owner: event.target.value })} /></label>
              </div>
              <label className="block">{t('pm.status')}<select className={field} value={task.status} onChange={(event) => update(task.id, { status: event.target.value as Task['status'] })}>
                {TASK_STATES.map(([value, text]) => <option key={value} value={value}>{t(text)}</option>)}
              </select></label>
              <details className="mt-2">
                <summary className="cursor-pointer py-2">{t('pm.taskDetails', { id: task.id })}</summary>
                <label className="block">{t('pm.dependencies')}<input className={field} value={(task.dependsOn ?? []).join(", ")} onChange={(event) => update(task.id, { dependsOn: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
                <label className="block">{t('pm.checks')}<textarea className={field} value={(task.verify ?? []).join("\n")} onChange={(event) => update(task.id, { verify: event.target.value.split("\n").filter(Boolean) })} /></label>
                <label className="block">{t('pm.acceptance')}<textarea className={field} maxLength={2000} value={task.acceptance} onChange={(event) => update(task.id, { acceptance: event.target.value })} /></label>
                <label className="block">{t('pm.evidence')}<textarea className={field} maxLength={2000} value={task.evidence} onChange={(event) => update(task.id, { evidence: event.target.value })} /></label>
                <label className="block">{t('pm.session')}<select className={field} value={task.sessionId} onChange={(event) => update(task.id, { sessionId: event.target.value })}>
                  <option value="">{t('pm.noSession')}</option>
                  {task.sessionId && !sessions.some((session) => session.id === task.sessionId) && <option value={task.sessionId}>{t('pm.missingSession')}</option>}
                  {sessions.filter((session) => session.projectId === projectId).map((session) => <option key={session.id} value={session.id}>{session.title || session.id}</option>)}
                </select></label>
                <button type="button" className="vp-control mt-2" onClick={async () => {
                  if (await confirmProjectAction(t('pm.deleteTaskBody', { title: task.title }), true)) setBoard((current) => current && ({ ...current, tasks: current.tasks.filter((item) => item.id !== task.id) }))
                }}>{t('pm.deleteTask')}</button>
              </details>
            </article>)}
          </section>
        })}
      </div>
    </fieldset>}
  </>
  if (embedded) return <section className="@container min-w-0">{content}</section>
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) void discard().then((yes) => { if (yes) onClose() }) }} className="@container m-auto max-h-[94dvh] w-[96vw] max-w-7xl overflow-y-auto rounded-vp-lg border border-hairline bg-surface p-4 text-ink shadow-xl backdrop:bg-black/60">{content}</dialog>
}
