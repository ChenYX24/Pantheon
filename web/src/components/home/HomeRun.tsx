import { useCallback, useEffect, useRef } from 'react'
import { AlertTriangle, CheckCircle2, GitMerge, LoaderCircle, OctagonX, SearchCheck, Square, XCircle } from 'lucide-react'
import { t } from '../../i18n'
import { homeApi, type HomeRun, type HomeRunState } from '../../protocol/home'
import { safeBody, safeText } from '../text'
import { StatusPill } from '../shell/StatusPill'
import { useHomeClock } from './clock'
import { runChip, runDuration } from './execution'
import { useHomeResource } from './useHomeResource'

export function HomeRunChip({ state }: { state: HomeRunState }) {
  const chip = runChip(state)
  const Icon = { running: LoaderCircle, reviewing: SearchCheck, accepted: CheckCircle2, rejected: XCircle, blocked: AlertTriangle, failed: OctagonX, stopped: Square, merged: GitMerge }[chip.icon]
  return <StatusPill label={t(chip.label)} color={chip.color} icon={Icon} state={state} />
}

export function HomeRunModels({ run }: { run: HomeRun }) {
  return <span className="[overflow-wrap:anywhere]">{safeText([run.harness, run.model].filter(Boolean).join('/')) || t('home.exec.pendingModel')} → {safeText(run.reviewer) || t('home.exec.pendingModel')}</span>
}

export function HomeRunDuration({ run }: { run: HomeRun }) {
  const now = useHomeClock()
  return <span>{runDuration(run, now)}</span>
}

export function HomeRunLog({ log }: { log: string }) {
  const root = useRef<HTMLPreElement>(null)
  const following = useRef(true)
  useEffect(() => {
    if (following.current && root.current) root.current.scrollTop = root.current.scrollHeight
  }, [log])
  return <pre ref={root} tabIndex={0} aria-label={t('home.exec.log')} className="max-h-64 min-w-0 max-w-full overflow-auto whitespace-pre-wrap rounded-vp border border-hairline bg-surface-2 p-2 font-mono text-vp-xs [overflow-wrap:anywhere]" onScroll={(event) => {
    const el = event.currentTarget
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }}>{safeBody(log) || t('home.exec.noLog')}</pre>
}

export function HomeTaskRun({ projectId, taskId, runId }: { projectId: string; taskId: string; runId: string }) {
  const load = useCallback((signal: AbortSignal) => homeApi.run(projectId, runId, signal), [projectId, runId])
  const detail = useHomeResource(load)
  const run = detail.data
  return <section className="mt-3 min-w-0 space-y-2 rounded-vp border border-hairline p-3 text-vp-sm" aria-label={t('home.exec.handoffFile')}>
    <h4 className="font-semibold">{t('home.exec.handoffFile')}</h4>
    {detail.error && <p role="alert">{safeText(detail.error)}</p>}
    {!run && detail.loading && <p role="status">{t('home.loading')}</p>}
    {detail.error && <button type="button" className="vp-control" onClick={() => void detail.refresh()}>{t('home.refresh')}</button>}
    {run && (run.taskId !== taskId || run.projectId !== projectId ? <p role="alert">{t('home.exec.runMissing')}</p> : <>
      <div className="flex flex-wrap items-center gap-2"><HomeRunChip state={run.state} /><HomeRunDuration run={run} /></div>
      <p><HomeRunModels run={run} /></p>
      <p className="font-mono text-vp-xs [overflow-wrap:anywhere]">{safeText(run.handoff) || t('home.exec.noHandoff')}</p>
      {run.summary && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{safeBody(run.summary)}</p>}
      {run.headCommit && <p className="text-vp-xs [overflow-wrap:anywhere]">{t('home.exec.commit')} · {safeText(run.baseCommit)} → {safeText(run.headCommit)}</p>}
    </>)}
  </section>
}
