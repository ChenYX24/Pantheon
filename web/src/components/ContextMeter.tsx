import type { ContextUsage } from '../protocol/wire'
import { t, useLang } from '../i18n'

function tokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1000) return `${Number((n / 1000).toFixed(1))}k`
  return String(n)
}

export function ContextMeter({ usage, compact = false }: { usage?: ContextUsage; compact?: boolean }) {
  useLang()
  if (!usage) return null
  const percent = usage.window > 0 ? usage.used / usage.window * 100 : null
  const figure = percent === null ? tokens(usage.used) : `${Math.round(percent)}%`
  const detail = percent === null ? tokens(usage.used) : `${tokens(usage.used)} / ${tokens(usage.window)}`
  const label = `${t('context.label')}: ${detail}`
  const color = percent !== null && percent >= 85 ? 'text-state-crashed'
    : percent !== null && percent >= 70 ? 'text-state-waiting' : 'text-ink-2'
  return (
    <span
      data-testid="context-meter"
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1 tabular text-vp-xs ${color} ${compact ? '' : 'rounded-md bg-surface-2 px-1.5 py-0.5'}`}
    >
      {!compact && <span>{t('context.label')}</span>}
      {figure}
      {percent !== null && (
        <span aria-hidden="true" className="h-1 w-4 overflow-hidden rounded-full bg-hairline">
          <span className="block h-full bg-current" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </span>
      )}
    </span>
  )
}
