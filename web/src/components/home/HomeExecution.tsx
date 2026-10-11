import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Square, Terminal } from 'lucide-react'
import { t } from '../../i18n'
import { homeApi, type HomeExecution as Execution, type HomeProject, type HomeRun, type HomeTask } from '../../protocol/home'
import { homeProjectLink, panelOpeningSession } from '../../routes'
import { askConfirm } from '../ask'
import { safeText } from '../text'
import { changeHomeAutonomy } from './actions'
import { activeRun, executionState } from './execution'
import { HomeAutonomyForm } from './HomeAutonomyForm'
import { HomeExecutionStatus } from './HomeExecutionStatus'
import { HomeRunChip, HomeRunDuration, HomeRunLog, HomeRunModels } from './HomeRun'
import { HomeRunHistory } from './HomeRunHistory'
import { useHomeMutation } from './useHomeMutation'
import { useHomeResource } from './useHomeResource'

export function HomeExecutionBanner({ execution, error, busy, onEnabled, onRetry }: {
  execution: Execution | null
  error: string
  busy: boolean
  onEnabled: (enabled: boolean) => void
  onRetry: () => void
}) {
  const state = executionState(execution)
  return <section className="min-w-0 space-y-2 rounded-vp border border-hairline bg-surface p-3" aria-label={t('home.exec.title')}>
    <HomeExecutionStatus execution={execution} />
    {state !== 'unknown' && <p className="text-vp-xs text-ink-2">{state === 'on' ? t('home.exec.on', { count: execution?.active.filter((run) => activeRun(run.state)).length ?? 0, max: execution?.maxRuns ?? 0 }) : t(`home.exec.${state}`)}</p>}
    {execution?.flag === 'allow' && <label className="flex items-start gap-2 text-vp-sm"><input type="checkbox" role="switch" className="mt-1 shrink-0" checked={execution.enabled} disabled={busy || !!error} onChange={(event) => onEnabled(event.target.checked)} />{t('home.exec.switch')}</label>}
    {error && <p role="alert" className="text-vp-sm">{safeText(error)}</p>}
    {!execution && <button type="button" className="vp-control" disabled={busy} onClick={onRetry}>{t('home.refresh')}</button>}
  </section>
}

export function HomeExecution({ project, tasks, execution, executionError, onChanged, onNavigate, returnSearch }: {
  project: HomeProject
  tasks: HomeTask[]
  execution: Execution | null
  executionError: string
  onChanged: () => Promise<unknown> | void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  returnSearch?: string
}) {
  const load = useCallback((signal: AbortSignal) => homeApi.runs(project.id, signal), [project.id])
  const history = useHomeResource(load)
  const refresh = async () => { await history.refresh(); await onChanged() }
  const { busy, run } = useHomeMutation(refresh)
  const candidate = execution?.active.find((run) => run.projectId === project.id) ?? project.activeRun ?? history.data?.find((run) => activeRun(run.state))
  const latest = candidate && (history.data?.find((run) => run.id === candidate.id) ?? candidate)
  const current = latest && activeRun(latest.state) ? latest : null
  const merge = (receipt: HomeRun) => void run(async () => {
    if (!await askConfirm({ title: t('home.exec.confirmMerge', { task: safeText(receipt.taskId) }), body: t('home.exec.mergeBody'), confirm: t('home.exec.merge'), cancel: t('home.cancel') })) return false
    await homeApi.mergeRun(project.id, receipt.id)
  })
  return <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]" data-testid="home-execution">
    <HomeExecutionBanner execution={execution} error={executionError} busy={busy} onEnabled={(enabled) => void run(() => homeApi.putExecution(enabled))} onRetry={() => void refresh()} />
    <HomeAutonomyForm project={project} tasks={tasks} busy={busy} onSave={(draft) => run(() => changeHomeAutonomy(project.id, draft))} />
    {current ? <HomeActiveRun key={current.id} projectId={project.id} runId={current.id} taskId={current.taskId} tasks={tasks} onChanged={refresh} onNavigate={onNavigate} returnSearch={returnSearch} /> : <p className="text-vp-sm text-ink-2">{t('home.exec.idle')}</p>}
    {history.error && <p role="alert" className="text-vp-sm">{safeText(history.error)} <button type="button" className="vp-control" onClick={() => void history.refresh()}>{t('home.refresh')}</button></p>}
    {!history.data && history.loading && <p role="status" className="text-vp-sm">{t('home.loading')}</p>}
    {history.data && <HomeRunHistory runs={history.data} tasks={tasks} busy={busy} onMerge={merge} onNavigate={onNavigate} returnSearch={returnSearch} />}
  </div>
}

function HomeActiveRun({ projectId, runId, taskId, tasks, onChanged, onNavigate, returnSearch }: {
  projectId: string
  runId: string
  taskId: string
  tasks: HomeTask[]
  onChanged: () => Promise<unknown> | void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  returnSearch?: string
}) {
  const load = useCallback((signal: AbortSignal) => homeApi.run(projectId, runId, signal), [projectId, runId])
  const detail = useHomeResource(load, 3000)
  const [stopping, setStopping] = useState(false)
  const reported = useRef(false)
  const { busy, run: mutate } = useHomeMutation(async () => { await detail.refresh(); await onChanged() })
  const run = detail.data
  const finished = !!run && !activeRun(run.state)
  useEffect(() => {
    if (finished && !reported.current) {
      reported.current = true
      void onChanged()
    }
  }, [finished, onChanged])
  return <section className="min-w-0 space-y-3 rounded-vp border border-hairline bg-surface p-3" aria-label={t('home.exec.active')}>
    <h2 className="text-vp-sm font-semibold">{t('home.exec.active')}</h2>
    <a className="block text-vp-sm hover:text-accent" href={homeProjectLink({ projectId, taskId }, returnSearch)} onClick={onNavigate}>{safeText(taskId)} · {safeText(tasks.find((task) => task.id === taskId)?.title ?? '')}</a>
    {detail.error && <p role="alert" className="text-vp-sm">{safeText(detail.error)}</p>}
    {!run && detail.loading && <p role="status" className="text-vp-sm">{t('home.loading')}</p>}
    {run && <>
      <div className="flex flex-wrap items-center gap-2"><HomeRunChip state={run.state} /><span className="text-vp-xs text-ink-2">{t('home.exec.elapsed')} · <HomeRunDuration run={run} /></span></div>
      <p className="text-vp-sm"><HomeRunModels run={run} /></p>
      <HomeRunLog log={run.log} />
      <div className="flex flex-wrap gap-2">
        {run.sessionId && <a className="vp-control home-wrap-control" href={panelOpeningSession(run.sessionId)}><Terminal size={14} className="shrink-0" />{t('home.exec.openTerminal')}</a>}
        {activeRun(run.state) && <button type="button" className="vp-control" disabled={busy || stopping} onClick={() => void mutate(async () => {
          if (!await askConfirm({ title: t('home.exec.confirmStop', { task: safeText(taskId) }), body: t('home.exec.stopBody'), confirm: t('home.exec.stop'), cancel: t('home.cancel'), destructive: true })) return false
          await homeApi.stopRun(projectId, runId)
          setStopping(true)
        })}><Square size={14} />{t('home.exec.stop')}</button>}
      </div>
      {stopping && !finished && <p role="status" className="text-vp-xs text-ink-2">{t('home.exec.stopping')}</p>}
    </>}
  </section>
}
