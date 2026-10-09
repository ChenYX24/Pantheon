import { useCallback, useState } from 'react'
import { Check, MessageSquare, Send } from 'lucide-react'
import { t } from '../../i18n'
import { homeApi, type HomeExecutor, type HomeSuggestion } from '../../protocol/home'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'
import { useHomeResource } from './useHomeResource'

const field = 'mt-1 w-full min-w-0 rounded-vp border border-hairline bg-surface px-3 py-2 text-vp-base text-ink'

export function HomeChat({ projectId, busy, onSend, onSuggestion }: {
  projectId: string
  busy: boolean
  onSend: (message: string, executor: HomeExecutor) => Promise<boolean>
  onSuggestion: (suggestion: HomeSuggestion) => Promise<boolean>
}) {
  const load = useCallback((signal: AbortSignal) => homeApi.discussion(projectId, signal), [projectId])
  const discussion = useHomeResource(load)
  const executors = useHomeResource(homeApi.executors, false)
  const [chosen, setChosen] = useState<HomeExecutor | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [applied, setApplied] = useState<Set<string>>(() => new Set())
  const options = executors.data ?? []
  const executor = chosen ?? options.find((item) => item.installed) ?? { harness: 'claude', model: '' }
  const installed = options.some((item) => item.harness === executor.harness && item.installed)

  return <section className="space-y-4" aria-label={t('home.tab.chat')}>
    <p className="text-vp-base text-ink-2">{t('home.chatHelp')}</p>
    {(discussion.error || executors.error) && <div role="alert" className="rounded-vp border border-hairline p-3 text-vp-sm">
      <p>{safeText(discussion.error || executors.error)}</p>
      <button type="button" className="vp-control mt-2" onClick={() => { void discussion.refresh(); void executors.refresh() }}>{t('home.retry')}</button>
    </div>}
    {!discussion.data && discussion.loading && <p role="status" className="text-ink-2">{t('home.loading')}</p>}
    {discussion.data?.messages.length === 0 && <p className="text-ink-2">{t('home.noMessages')}</p>}
    <div className="space-y-3" role="log" aria-label={t('home.tab.chat')} aria-live="polite">
      {discussion.data?.messages.map((entry) => <article key={entry.id} className={`min-w-0 rounded-vp border border-hairline p-3 ${entry.role === 'user' ? 'bg-surface-2' : 'bg-surface'}`}>
        <div className="flex flex-wrap items-center gap-2 text-vp-xs text-ink-2"><MessageSquare size={13} /><strong>{entry.role === 'user' ? t('home.you') : t('home.manager')}</strong><HomeTime at={entry.at} />{entry.executor && <span>{safeText(`${entry.executor.harness}/${entry.executor.model}`)}</span>}</div>
        <div className="min-w-0 overflow-hidden"><Markdown text={entry.text} /></div>
        {entry.suggestedModel && <div className="mt-2 min-w-0 rounded-vp border border-hairline p-2 text-vp-sm">
          <p>{t('home.suggestedModel', { model: safeText(`${entry.suggestedModel.harness}/${entry.suggestedModel.model}`) })}</p>
          <p className="mt-1 text-ink-2">{safeText(entry.suggestedModel.reason)}</p>
          <button type="button" className="vp-control mt-2" disabled={busy || !options.some((item) => item.harness === entry.suggestedModel?.harness && item.installed)} onClick={() => {
            if (entry.suggestedModel) setChosen({ harness: entry.suggestedModel.harness, model: entry.suggestedModel.model })
          }}>{t('home.useModel')}</button>
        </div>}
        {entry.suggestions?.map((suggestion, i) => {
          const key = `${entry.id}:${i}`
          return <div key={key} className="mt-2 min-w-0 rounded-vp border border-hairline p-2">
            <p className="text-vp-base">{suggestion.type === 'create_task' ? t('home.suggestion.createTask', { title: safeText(suggestion.task.title) }) : suggestion.type === 'set_status' ? t('home.suggestion.setStatus', { id: safeText(suggestion.taskId), status: t(`home.status.${suggestion.status}`) }) : t('home.suggestion.createSession', { name: safeText(suggestion.name) })}</p>
            {suggestion.type === 'create_task' && <div className="mt-2 text-vp-sm text-ink-2">
              {suggestion.task.stage && <p>{t('home.stage', { name: safeText(suggestion.task.stage) })}</p>}
              {suggestion.task.primary && <p>{t('home.primary')}: {safeText(suggestion.task.primary)}</p>}
              {suggestion.task.secondary && <p>{t('home.secondary')}: {safeText(suggestion.task.secondary)}</p>}
              {suggestion.task.body && <div className="min-w-0 overflow-hidden"><Markdown text={suggestion.task.body} /></div>}
            </div>}
            <button type="button" className="vp-control mt-2" disabled={busy || applied.has(key)} onClick={async () => {
              if (await onSuggestion(suggestion)) setApplied((old) => new Set([...old, key]))
            }}><Check size={14} />{applied.has(key) ? t('home.applied') : suggestion.type === 'create_task' ? t('home.createTask') : suggestion.type === 'create_session' ? t('home.newSession') : t('home.confirm')}</button>
          </div>
        })}
      </article>)}
    </div>
    <form className="min-w-0 space-y-3 rounded-vp border border-hairline bg-surface p-3" onSubmit={async (event) => {
      event.preventDefault()
      if (busy || sending || !installed || !executor.model.trim() || !message.trim()) return
      setSending(true)
      const sent = await onSend(message.trim(), { harness: executor.harness, model: executor.model.trim() })
      if (sent) setMessage('')
      await discussion.refresh()
      setSending(false)
    }}>
      <div className="grid min-w-0 gap-3 @lg:grid-cols-2">
        <label className="min-w-0 text-vp-sm">{t('home.executor')}<select className={field} disabled={busy || !options.length} value={options.length ? executor.harness : ''} onChange={(event) => {
          const next = options.find((item) => item.harness === event.target.value)
          if (next) setChosen({ harness: next.harness, model: next.model })
        }}>
          {!options.length && <option value="">{t('home.noExecutors')}</option>}
          {options.map((item) => <option key={item.harness} value={item.harness} disabled={!item.installed}>{item.harness}{item.installed ? '' : ` · ${t('home.notInstalled')}`}</option>)}
        </select></label>
        <label className="min-w-0 text-vp-sm">{t('home.model')}<input className={field} required value={executor.model} disabled={busy} onChange={(event) => setChosen({ harness: executor.harness, model: event.target.value })} /></label>
      </div>
      <label className="block text-vp-sm">{t('home.message')}<textarea className={field} rows={4} value={message} disabled={busy} placeholder={t('home.messagePlaceholder')} onChange={(event) => setMessage(event.target.value)} /></label>
      <button type="submit" className="vp-control" disabled={busy || sending || !installed || !executor.model.trim() || !message.trim()}><Send size={14} />{sending ? t('home.thinking') : t('home.send')}</button>
    </form>
  </section>
}
