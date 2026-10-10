import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { FileText, HelpCircle } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeReport } from '../../protocol/home'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'
import { projectLink } from './helpers'

export function HomeReports({ projectId, reports, target, active, onNavigate, onReply, busy, returnSearch }: {
  projectId: string
  reports: HomeReport[]
  target?: string
  active: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  onReply: (report: HomeReport, text: string) => Promise<boolean>
  busy: boolean
  returnSearch?: string
}) {
  useEffect(() => {
    if (active && target) {
      const card = document.getElementById(`home-report-${encodeURIComponent(target)}`)
      card?.scrollIntoView({ block: 'nearest' })
      card?.querySelector('textarea')?.focus({ preventScroll: true })
    }
  }, [active, target, reports.length])

  return <section className="space-y-4" aria-label={t('home.tab.reports')}>
    {!reports.length && <p className="text-ink-2">{t('home.noReports')}</p>}
    {reports.map((report) => <ReportCard key={report.file} projectId={projectId} report={report} selected={target === report.file} onNavigate={onNavigate} onReply={onReply} busy={busy} returnSearch={returnSearch} />)}
  </section>
}

function ReportCard({ projectId, report, selected, onNavigate, onReply, busy, returnSearch }: {
  projectId: string
  report: HomeReport
  selected: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  onReply: (report: HomeReport, text: string) => Promise<boolean>
  busy: boolean
  returnSearch?: string
}) {
  const [text, setText] = useState('')
  const original = useRef<HomeReport | null>(null)
  return <article id={`home-report-${encodeURIComponent(report.file)}`} className={`min-w-0 scroll-mt-4 rounded-vp border bg-surface p-3 ${selected ? 'border-accent' : 'border-hairline'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-vp-xs text-ink-2">
        {report.kind === 'question' ? <HelpCircle size={14} /> : <FileText size={14} />}
        <span>{report.kind === 'question' ? t('home.question') : t('home.report')}</span>
        <HomeTime at={report.at} />
        {report.needsUser && <span className="rounded-vp border border-hairline px-2 py-1">{t('home.needsUser')}</span>}
      </div>
      <h3 className="text-vp-md font-semibold">{safeText(report.title)}</h3>
      <p className="mt-2 text-vp-base text-ink-2">{safeText(report.summary)}</p>
      {report.task && <a href={projectLink({ projectId, taskId: report.task }, returnSearch)} onClick={onNavigate} className="vp-control mt-2">{t('home.reportTask', { id: safeText(report.task) })}</a>}
      <div className="mt-2 min-w-0 overflow-hidden"><Markdown text={report.body} /></div>
      {report.replies.length > 0 && <section className="mt-3 space-y-2 border-t border-hairline pt-3" aria-label={t('home.replies')}>{report.replies.map((reply, index) => <div key={`${reply.at}:${index}`} className="rounded-vp bg-surface-2 p-3"><p className="text-vp-xs text-ink-2"><HomeTime at={reply.at} /></p><Markdown text={reply.text} /></div>)}</section>}
      {(report.needsUser || text) && <form className="mt-3 space-y-2" onSubmit={async (event) => {
        event.preventDefault()
        if (!text.trim() || busy) return
        if (await onReply(original.current ?? report, text.trim())) setText('')
        original.current = null
      }}>
        <label className="block text-vp-sm">{t('home.reply')}<textarea className="home-input mt-1" rows={3} value={text} disabled={busy} placeholder={t('home.replyPlaceholder')} onChange={(event) => { original.current ??= report; setText(event.target.value) }} /></label>
        <button className="vp-control" type="submit" disabled={busy || !text.trim()}>{busy ? t('home.saving') : t('home.reply')}</button>
      </form>}
    </article>
}
