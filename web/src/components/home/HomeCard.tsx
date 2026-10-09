import type { MouseEvent } from 'react'
import { AlertTriangle, ArrowUpRight, FileText, Pin, PinOff } from 'lucide-react'
import { t, tKey, useLang } from '../../i18n'
import { HOME_TASK_STATUSES, type HomeFields, type HomeProject } from '../../protocol/home'
import { panelOpeningSession } from '../../routes'
import { StateDot } from '../StateDot'
import { safeText } from '../text'
import { projectLink, relativeTime, stageProgress } from './helpers'
import { HomeChip } from './HomeField'
import { useHomeClock } from './clock'

export function HomeTime({ at }: { at: string }) {
  const lang = useLang()
  const now = useHomeClock()
  return <time dateTime={at} title={safeText(at)}>{relativeTime(at, now, lang) || '—'}</time>
}

export function HomeCard({ project, onNavigate, fields, onPin, busy, returnSearch }: { project: HomeProject; onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void; fields?: HomeFields; onPin?: () => void; busy?: boolean; returnSearch?: string }) {
  return (
    <article data-testid="home-project-card" className="relative min-w-0 rounded-vp-lg border border-hairline bg-surface p-4 [overflow-wrap:anywhere]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-vp-md font-semibold">
            <a className="hover:text-accent after:absolute after:inset-0" href={projectLink({ projectId: project.id }, returnSearch)} onClick={onNavigate}>{safeText(project.id)} <ArrowUpRight size={14} className="inline" /></a>
          </h3>
          {project.aliases.length > 0 && <p className="mt-1 text-vp-sm text-ink-2">{safeText(project.aliases.join(' · '))}</p>}
        </div>
        <span className="max-w-[40%] rounded-vp border border-hairline px-2 py-1 text-vp-xs text-ink-2">{tKey(`home.project.${project.status}`) ?? safeText(project.status)}</span>
        {onPin && <button type="button" className="vp-control relative z-10" disabled={busy} aria-pressed={project.meta.pinned} title={t(project.meta.pinned ? 'home.unpin' : 'home.pin')} onClick={onPin}>{project.meta.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>}
      </div>
      <p className="mt-3 line-clamp-3 text-vp-base text-ink-2">{safeText(project.goal) || t('home.noGoal')}</p>
      <div className="mt-2 flex flex-wrap gap-1">{project.meta.labels.map((value) => <HomeChip key={value} value={value} options={fields?.project.labels.options} />)}{project.meta.priority && <HomeChip value={project.meta.priority} options={fields?.project.priority.options} />}{project.meta.phase && <HomeChip value={project.meta.phase} options={fields?.project.phase.options} />}</div>
      {project.stages.length > 0 && <div className="mt-4 space-y-2">
        {project.stages.map((stage) => {
          const progress = stageProgress(stage)
          return <div key={stage.name}>
            <div className="mb-1 flex flex-wrap justify-between gap-x-2 text-vp-xs text-ink-2"><span>{t('home.stage', { name: safeText(stage.name) })}</span><span>{t('home.progress', progress)}</span></div>
            <div role="progressbar" aria-label={t('home.stage', { name: safeText(stage.name) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={t('home.progress', progress)} className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${progress.percent}%` }} /></div>
          </div>
        })}
      </div>}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-vp-xs text-ink-2" aria-label={t('home.taskCount', { count: project.taskCounts.total })}>
        <span>{t('home.taskCount', { count: project.taskCounts.total })}</span>
        {HOME_TASK_STATUSES.filter((status) => project.taskCounts[status] > 0).map((status) => <span key={status}>{t(`home.status.${status}`)} {project.taskCounts[status]}</span>)}
      </div>
      <div className="mt-4 border-t border-hairline pt-3">
        <p className="mb-1 flex items-center gap-1 text-vp-xs text-ink-2"><FileText size={13} />{t('home.latestReport')}</p>
        {project.latestReport ? <>
          <a className="relative z-10 text-vp-base font-medium hover:text-accent" href={projectLink({ projectId: project.id, reportFile: project.latestReport.file }, returnSearch)} onClick={onNavigate}>{safeText(project.latestReport.title)}</a>
          <p className="mt-1 text-vp-base text-ink-2">{safeText(project.latestReport.summary)}</p>
          <p className="mt-1 text-vp-xs text-ink-3"><HomeTime at={project.latestReport.at} /></p>
        </> : <p className="text-vp-sm text-ink-3">{t('home.noReports')}</p>}
      </div>
      {project.blockers.length > 0 && <div className="mt-3 rounded-vp border border-hairline p-2">
        <p className="flex items-center gap-1 text-vp-xs font-medium"><AlertTriangle size={13} />{t('home.blockers')}</p>
        <ul className="mt-1 space-y-1 text-vp-sm text-ink-2">{project.blockers.map((blocker, i) => <li key={i}>{safeText(blocker)}</li>)}</ul>
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-vp-xs text-ink-2">
        <span>{t('home.sessions', { count: project.sessions.length })}</span>
        {project.sessions.map((session) => <a key={session.id} href={panelOpeningSession(session.id)} title={safeText(session.name || session.id)} aria-label={t('home.openTerminal') + ' · ' + safeText(session.name || session.id)} className="vp-control relative z-10"><StateDot state={session.state} /></a>)}
        <span className="ml-auto">{t('home.usageUnknown')}</span>
      </div>
    </article>
  )
}
