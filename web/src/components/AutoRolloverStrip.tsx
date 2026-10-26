import { useEffect, useState } from 'react'
import { Clock, TriangleAlert } from 'lucide-react'
import type { AutoRollover, AutoRolloverAction } from '../protocol/wire'
import { api } from '../protocol/api'
import { t, useLang } from '../i18n'
import { safeText } from './text'
import { rolloverSeconds } from './rollover'

export function AutoRolloverStrip({ sessionId, status, summary = '', onSelect, disconnected = false }: {
  sessionId: string
  status?: AutoRollover
  summary?: string
  onSelect?: (id: string) => void
  disconnected?: boolean
}) {
  useLang()
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const counting = status?.state === 'countdown'
  const releasing = status?.state === 'handed_off'
  useEffect(() => {
    if (!counting && !releasing) return
    // A strip can spend minutes due before it first needs a clock.
    const first = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [counting, releasing, status?.endsAt])
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
  const seconds = rolloverSeconds(status.endsAt ?? now, now)
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  let text: string
  let actions: AutoRolloverAction[] = []
  switch (status.state) {
    case 'handed_off':
      text = t('autoRollover.handedOff', { time })
      actions = ['keep', 'release']
      break
    case 'verifying':
      text = t(status.replaces ? 'autoRollover.receiving' : 'autoRollover.verifying')
      if (!status.replaces) actions = ['keep']
      break
    case 'confirmed': text = t('autoRollover.confirmed', { summary: safeText(summary) }); break
    case 'countdown':
      text = t('autoRollover.countdown', { n: seconds })
      actions = ['cancel']
      break
    case 'handing_off': text = t('autoRollover.handingOff'); break
    case 'failed': text = t('autoRollover.failed', { reason: safeText(status.reason ?? '') }); break
    default:
      text = asked ? t('autoRollover.requested') : t('autoRollover.due', { pct: status.pct })
      actions = asked ? ['cancel'] : ['now', 'later', 'never']
  }
  const nextId = status.newSessionId
  return <div data-testid="auto-rollover" className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-surface-2 px-3 py-2 text-vp-sm">
    {failed ? <TriangleAlert size={14} className="shrink-0 text-state-crashed" aria-hidden="true" /> : <Clock size={14} className="shrink-0 text-state-waiting" aria-hidden="true" />}
    <span role="status" className="min-w-0 flex-1 basis-48 break-words text-ink-2">
      {text}
      {/* Why nothing is happening. Without it a requested handoff on a session
          that is not quiet reads as broken: the same line for as long as it
          takes. */}
      {status.state === 'due' && status.waiting && <span data-testid="rollover-waiting" className="block text-vp-xs text-ink-3">{t(`autoRollover.wait.${status.waiting}`)}</span>}
    </span>
    <span className="flex min-w-0 flex-wrap gap-1">
      {nextId && onSelect && <button type="button" className="vp-control" onClick={() => onSelect(nextId)}>{t('rollover.open')}</button>}
      {actions.map((action) =>
        <button key={action} type="button" className="vp-control" disabled={busy || disconnected} onClick={() => void act(action)}>{t(`autoRollover.${action}`)}</button>,
      )}
    </span>
    {error && <span role="alert" className="w-full break-words text-state-crashed">{safeText(error)}</span>}
  </div>
}
