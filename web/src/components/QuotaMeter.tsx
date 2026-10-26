import { Gauge } from 'lucide-react'
import type { AgentQuota } from '../protocol/wire'
import { t, useLang } from '../i18n'
import { useNow } from './pages/usePages'
import { currentLimits, windowLabel } from './quota'

function resetText(resetsAt: number, nowSec: number, lang: string): string {
  if (!resetsAt) return ''
  const at = new Date(resetsAt * 1000)
  const sameDay = at.toDateString() === new Date(nowSec * 1000).toDateString()
  const time = at.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return t('quota.resets', { time })
}

/**
 * What this session's account has used of its subscription, beside the
 * context meter: the two numbers that decide whether a long task can be
 * started now or has to wait for a window to reset.
 */
export function QuotaMeter({ quota }: { quota?: AgentQuota }) {
  const lang = useLang()
  // Ticking, so a window that resets while the page is open drops out then
  // and not at the next snapshot, which may be an hour away on an idle panel.
  const nowSec = useNow(30_000)
  const limits = currentLimits(quota, nowSec)
  if (!quota || limits.length === 0) return null
  const agent = quota.source === 'codex-rollout' ? 'Codex' : 'Claude'
  const highest = Math.max(...limits.map((l) => l.used))
  const parts = limits.map((l) => `${windowLabel(l.minutes)} ${l.used}%`)
  const detail = limits.map((l) => {
    const reset = resetText(l.resetsAt, nowSec, lang)
    return `${windowLabel(l.minutes)} ${l.used}%${reset ? ` · ${reset}` : ''}`
  })
  const name = quota.plan ? `${agent} ${quota.plan}` : agent
  const label = `${t('quota.title', { agent: name })}: ${detail.join('; ')}`
  // The percentage is the meaning and it is text; the colour only repeats it
  // (red line 4). The same steps as the context meter, so one glance reads both.
  const color = highest >= 95 ? 'text-state-crashed' : highest >= 80 ? 'text-state-waiting' : 'text-ink-2'
  return (
    <span
      data-testid="quota-meter"
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 tabular text-vp-xs ${color}`}
    >
      <Gauge size={11} aria-hidden="true" />
      {parts.join(' · ')}
    </span>
  )
}
