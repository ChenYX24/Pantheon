import { Check } from 'lucide-react'
import { t, type Key } from '../../i18n'
import type { HomeSuggestion } from '../../protocol/home'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'

function suggestionLabel(suggestion: HomeSuggestion): string {
  switch (suggestion.type) {
    case 'create_task': return t('home.suggestion.createTask', { title: safeText(suggestion.task.title) })
    case 'set_status': return t('home.suggestion.setStatus', { id: safeText(suggestion.taskId), status: t(`home.status.${suggestion.status}`) })
    case 'create_session': return t('home.suggestion.createSession', { name: safeText(suggestion.name) })
    case 'set_fields': return t('home.suggestion.setFields', { id: safeText(suggestion.taskId) })
    case 'set_project': return t('home.suggestion.setProject')
    case 'reply_report': return t('home.suggestion.replyReport', { file: safeText(suggestion.file) })
    case 'use_resources': return t('home.res.useSuggestion')
  }
}

function SuggestionDetails({ suggestion }: { suggestion: HomeSuggestion }) {
  if (suggestion.type === 'use_resources') return <p className="text-vp-xs text-ink-2">{safeText(suggestion.resources.join(' · '))}</p>
  if (suggestion.type === 'reply_report') return <Markdown text={suggestion.text} />
  if (suggestion.type === 'create_task') return <><p className="text-vp-xs text-ink-2">{safeText([suggestion.task.stage, suggestion.task.primary, suggestion.task.secondary].filter(Boolean).join(' · '))}</p>{suggestion.task.body && <Markdown text={suggestion.task.body} />}</>
  if (suggestion.type !== 'set_fields' && suggestion.type !== 'set_project') return null
  const labels: Record<string, Key> = { title: 'home.table.title', status: 'home.status', priority: 'home.table.priority', tags: 'home.table.tags', owner: 'home.table.owner', due: 'home.table.due', stage: 'home.table.stage', primary: 'home.primary', secondary: 'home.secondary', dependsOn: 'home.dependencies', labels: 'home.table.labels', phase: 'home.table.phase', pinned: 'home.pin', blockedReason: 'home.blockedReason', session: 'home.taskSession', sessionStatus: 'home.sessionStatus' }
  return <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-vp-xs text-ink-2">{Object.entries(suggestion.fields).map(([key, value]) => <div key={key} className="contents"><dt>{labels[key] ? t(labels[key]) : safeText(key)}</dt><dd>{safeText(Array.isArray(value) ? value.join(', ') : String(value))}</dd></div>)}</dl>
}

export function HomeSuggestionAction({ suggestion, applied, disabled, onApply }: { suggestion: HomeSuggestion; applied: boolean; disabled: boolean; onApply: () => void }) {
  return <div className="mt-2 min-w-0 space-y-1 rounded-vp border border-hairline p-2">
    <SuggestionDetails suggestion={suggestion} />
    <button type="button" className="vp-control home-wrap-control max-w-full whitespace-normal text-left" disabled={disabled || applied} onClick={onApply}><Check size={14} className="shrink-0" />{applied ? t('home.applied') : suggestionLabel(suggestion)}</button>
  </div>
}
