import { useEffect, useState } from 'react'
import { Clock, TriangleAlert } from 'lucide-react'
import type { AutoRollover, AutoRolloverAction } from '../protocol/wire'
import { api } from '../protocol/api'
import { t, useLang } from '../i18n'
import { safeText } from './text'
import { rolloverSeconds } from './rollover'

export function AutoRolloverStrip({ sessionId, status, disconnected = false }: {
  sessionId: string
  status?: AutoRollover
  disconnected?: boolean
}) {
  useLang()
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const counting = status?.state === 'countdown'
  useEffect(() => {
    if (!counting) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [counting, status?.endsAt])
  if (!status || status.state === 'ok' || status.state === 'cancelled') return null

  const act = async (action: AutoRolloverAction) => {
    setBusy(true)
    setError('')
    try { await api.autoRollover(sessionId, action) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const failed = status.state === 'failed'
  // The person asked for this one. Its percentage is beside the point, and
  // "Never" and "Later" are about the automatic trigger they are not using.
  const asked = status.reason === 'now' && status.state === 'due'
  const text = counting ? t('autoRollover.countdown', { n: rolloverSeconds(status.endsAt ?? now, now) })
    : status.state === 'handing_off' ? t('autoRollover.handingOff')
      : failed ? t('autoRollover.failed') : asked ? t('autoRollover.requested') : t('autoRollover.due', { pct: status.pct })
  return <div data-testid="auto-rollover" className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-surface-2 px-3 py-2 text-vp-sm">
    {failed ? <TriangleAlert size={14} className="shrink-0 text-state-crashed" aria-hidden="true" /> : <Clock size={14} className="shrink-0 text-state-waiting" aria-hidden="true" />}
    <span role="status" className="min-w-0 flex-1 text-ink-2">
      {text}
      {/* Why nothing is happening. Without it a requested handoff on a session
          that is not quiet reads as broken: the same line for as long as it
          takes. */}
      {status.state === 'due' && status.waiting && <span data-testid="rollover-waiting" className="block text-vp-xs text-ink-3">{t(`autoRollover.wait.${status.waiting}`)}</span>}
    </span>
    <span className="flex min-w-0 flex-wrap gap-1">
      {(counting || asked ? ['cancel'] as const : status.state === 'handing_off' ? [] : ['now', 'later', 'never'] as const).map((action) =>
        <button key={action} type="button" className="vp-control" disabled={busy || disconnected} onClick={() => void act(action)}>{t(`autoRollover.${action}`)}</button>,
      )}
    </span>
    {error && <span role="alert" className="w-full break-words text-state-crashed">{safeText(error)}</span>}
  </div>
}
