import { Fragment, type MouseEvent, type ReactNode } from 'react'
import { GitMerge } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeRun, HomeTask } from '../../protocol/home'
import { homeProjectLink } from '../../routes'
import { safeText } from '../text'
import { activeRun } from './execution'
import { HomeRunChip, HomeRunDuration, HomeRunModels } from './HomeRun'

export function HomeRunHistory({ runs, tasks, busy, onMerge, onNavigate, returnSearch }: {
  runs: HomeRun[]
  tasks: HomeTask[]
  busy: boolean
  onMerge: (run: HomeRun) => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  returnSearch?: string
}) {
  const headers = [t('home.status'), t('home.tab.tasks'), t('home.exec.models'), t('home.exec.duration'), t('home.exec.commit'), t('home.exec.title')]
  const cells = (run: HomeRun): ReactNode[] => [
    <HomeRunChip state={run.state} />,
    <a className="text-ink hover:text-accent" href={homeProjectLink({ projectId: run.projectId, taskId: run.taskId }, returnSearch)} onClick={onNavigate}>{safeText(run.taskId)}<span className="mt-1 block text-vp-xs text-ink-2">{safeText(tasks.find((task) => task.id === run.taskId)?.title ?? '')}</span></a>,
    <HomeRunModels run={run} />,
    <HomeRunDuration run={run} />,
    <code title={safeText(run.headCommit)}>{safeText(run.headCommit.slice(0, 8)) || '—'}</code>,
    <div className="flex flex-wrap gap-1">
      {run.state === 'accepted' && <button type="button" className="vp-control" disabled={busy} onClick={() => onMerge(run)}><GitMerge size={14} />{t('home.exec.merge')}</button>}
      {!activeRun(run.state) && <a className="vp-control home-wrap-control" href={homeProjectLink({ projectId: run.projectId, taskId: run.taskId, runId: run.id }, returnSearch)} onClick={onNavigate}>{t('home.exec.handoff')}</a>}
    </div>,
  ]
  const rows = runs.map((run) => ({ id: run.id, cells: cells(run) }))
  return <section className="@container min-w-0 space-y-3" aria-label={t('home.exec.history')}>
    <h2 className="text-vp-sm font-semibold">{t('home.exec.history')}</h2>
    {!runs.length && <p className="text-vp-sm text-ink-2">{t('home.exec.noRuns')}</p>}
    {runs.length > 0 && <>
      <div className="hidden max-h-[60dvh] min-w-0 max-w-full overflow-auto rounded-vp border border-hairline @3xl:block"><table className="home-table"><thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>
      <div className="space-y-3 @3xl:hidden">{rows.map((row) => <article key={row.id} className="min-w-0 rounded-vp border border-hairline bg-surface p-3"><dl className="grid min-w-0 grid-cols-[minmax(0,5rem)_minmax(0,1fr)] items-start gap-2">{row.cells.map((cell, index) => <Fragment key={index}><dt className="text-vp-xs text-ink-2">{headers[index]}</dt><dd className="min-w-0 text-vp-sm [overflow-wrap:anywhere]">{cell}</dd></Fragment>)}</dl></article>)}</div>
    </>}
  </section>
}
