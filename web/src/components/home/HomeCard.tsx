import type { MouseEvent } from 'react'
import { AlertTriangle, ArrowUpRight, Pin, PinOff, Play, Terminal } from 'lucide-react'
import { t, useLang } from '../../i18n'
import type { HomeFields, HomeProject } from '../../protocol/home'
import { HOME_PATH, panelOpeningSession } from '../../routes'
import { StateDot } from '../StateDot'
import { safeText } from '../text'
import { ProjectStatus } from '../shell/AppShell'
import { Badge } from '../shell/StatusPill'
import { currentStage } from '../shell/model'
import { projectLink, relativeTime, stageProgress } from './helpers'
import { HomeChip } from './HomeField'
import { useHomeClock } from './clock'

export function HomeTime({ at }: { at: string }) {
  const lang = useLang()
  const now = useHomeClock()
  return <time dateTime={at} title={safeText(at)}>{relativeTime(at, now, lang) || '—'}</time>
}

export function HomeCard({ project, onNavigate, fields, onPin, busy, returnSearch, todoCount = 0 }: { project: HomeProject; onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void; fields?: HomeFields; onPin?: () => void; busy?: boolean; returnSearch?: string; todoCount?: number }) {
  const stage = currentStage(project)
  const progress = stage ? stageProgress(stage) : null
  const running = project.taskCounts.in_progress
  return <article data-testid="home-project-card" className="shell-card relative flex min-w-0 flex-col gap-4">
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <h3 className="shell-section-title truncate"><a className="hover:underline after:absolute after:inset-0" href={projectLink({ projectId: project.id }, returnSearch)} onClick={onNavigate}>{safeText(project.id)} <ArrowUpRight size={14} className="inline" /></a></h3>
        {!!project.aliases.length && <p className="mt-1 truncate text-vp-xs text-ink-2">{safeText(project.aliases.join(' · '))}</p>}
      </div>
      <ProjectStatus project={project} />
      {onPin && <button type="button" className="vp-control relative z-10" disabled={busy} aria-pressed={project.meta.pinned} title={t(project.meta.pinned ? 'home.unpin' : 'home.pin')} onClick={onPin}>{project.meta.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>}
    </div>
    <p className="line-clamp-2 text-vp-base text-ink-2">{safeText(project.goal) || t('home.noGoal')}</p>
    {(project.meta.labels.length > 0 || project.meta.priority) && <div className="flex flex-wrap gap-1">{project.meta.labels.map((value) => <HomeChip key={value} value={value} options={fields?.project.labels.options} />)}{project.meta.priority && <HomeChip value={project.meta.priority} options={fields?.project.priority.options} />}</div>}
    {stage && progress && <div>
      <div className="mb-1 flex justify-between gap-2 text-vp-xs text-ink-2"><span className="truncate">{t('home.stage', { name: safeText(stage.name) })}</span><span className="shrink-0">{t('home.progress', progress)}</span></div>
      <div role="progressbar" aria-label={t('home.stage', { name: safeText(stage.name) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={t('home.progress', progress)} className="h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${progress.percent}%` }} /></div>
    </div>}
    {project.latestReport && <p className="flex min-w-0 gap-1 text-vp-xs text-ink-2"><a className="relative z-10 min-w-0 flex-1 truncate hover:underline" href={projectLink({ projectId: project.id, reportFile: project.latestReport.file }, returnSearch)} onClick={onNavigate}>{t('home.shell.latest')} {safeText(project.latestReport.title)}</a><span className="shrink-0">· <HomeTime at={project.latestReport.at} /></span></p>}
    {!!project.blockers.length && <p className="flex min-w-0 items-start gap-1 text-vp-xs text-ink-2" title={safeText(project.blockers.join(' · '))}><AlertTriangle size={14} className="shrink-0" /><span className="line-clamp-1">{t('home.blockers')} · {safeText(project.blockers[0])}</span></p>}
    {(project.sessions.length > 0 || todoCount > 0 || running > 0 || project.activeRun) && <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-vp-xs text-ink-2">
      {!!project.sessions.length && <><a className="vp-control relative z-10" href={projectLink({ projectId: project.id, tab: 'sessions' }, returnSearch)} onClick={onNavigate} aria-label={t('home.sessions', { count: project.sessions.length })}><Terminal size={14} /><Badge count={project.sessions.length} /></a>{project.sessions.slice(0, 3).map((session) => <a key={session.id} href={panelOpeningSession(session.id)} title={safeText(session.name || session.id)} aria-label={t('home.openTerminal') + ' · ' + safeText(session.name || session.id)} className="vp-control relative z-10"><StateDot state={session.state} /></a>)}</>}
      {todoCount > 0 && <a className="vp-control relative z-10" href={`${HOME_PATH}?view=todo&filterProject=${encodeURIComponent(project.id)}&all=1`} onClick={onNavigate}>{t('home.view.todo')}<Badge count={todoCount} /></a>}
      {(running > 0 || project.activeRun) && <a className="vp-control relative z-10 home-wrap-control" title={project.activeRun ? t('home.exec.taskRunning', { task: safeText(project.activeRun.taskId) }) : t('home.status.in_progress')} href={projectLink({ projectId: project.id, tab: 'execution' }, returnSearch)} onClick={onNavigate}><Play size={14} />{project.activeRun ? safeText(project.activeRun.taskId) : t('home.status.in_progress')}<Badge count={running} /></a>}
    </footer>}
  </article>
}
