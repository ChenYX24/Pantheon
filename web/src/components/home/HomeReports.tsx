import { useEffect, type MouseEvent } from 'react'
import { FileText, HelpCircle } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeReport } from '../../protocol/home'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'
import { projectLink } from './helpers'

export function HomeReports({ projectId, reports, target, active, onNavigate }: {
  projectId: string
  reports: HomeReport[]
  target?: string
  active: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  useEffect(() => {
    if (active && target) document.getElementById(`home-report-${encodeURIComponent(target)}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, target, reports.length])

  return <section className="space-y-4" aria-label={t('home.tab.reports')}>
    {!reports.length && <p className="text-ink-2">{t('home.noReports')}</p>}
    {reports.map((report) => <article key={report.file} id={`home-report-${encodeURIComponent(report.file)}`} className={`min-w-0 scroll-mt-4 rounded-vp border bg-surface p-3 ${target === report.file ? 'border-accent' : 'border-hairline'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-vp-xs text-ink-2">
        {report.kind === 'question' ? <HelpCircle size={14} /> : <FileText size={14} />}
        <span>{report.kind === 'question' ? t('home.question') : t('home.report')}</span>
        <HomeTime at={report.at} />
        {report.needsUser && <span className="rounded-vp border border-hairline px-2 py-1">{t('home.needsUser')}</span>}
      </div>
      <h3 className="text-vp-md font-semibold">{safeText(report.title)}</h3>
      <p className="mt-2 text-vp-base text-ink-2">{safeText(report.summary)}</p>
      {report.task && <a href={projectLink({ projectId, taskId: report.task })} onClick={onNavigate} className="vp-control mt-2">{t('home.reportTask', { id: safeText(report.task) })}</a>}
      <div className="mt-2 min-w-0 overflow-hidden"><Markdown text={report.body} /></div>
    </article>)}
  </section>
}
