import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import type { AutoRollover } from '../protocol/wire'
import { api } from '../protocol/api'
import { t, useLang } from '../i18n'
import { safeText } from './text'
import { showToast } from './toasts'

/**
 * Ask for a handoff of this session, whatever the automatic setting says.
 *
 * It was only reachable by an API call: the same actions lived behind a "…"
 * menu that nobody found, and the automatic path could not be exercised on a
 * session below the threshold's floor. The request goes through the same
 * boundary and countdown as an automatic one -- waits for the turn to end,
 * counts down, any keystroke cancels -- so pressing it mid-reply interrupts
 * nothing.
 */
export function HandoffButton({ sessionId, status, disabled = false, compact = false }: {
  sessionId: string
  status?: AutoRollover
  disabled?: boolean
  /** Icon only, for a header with no room for a word. */
  compact?: boolean
}) {
  useLang()
  const [busy, setBusy] = useState(false)
  const underway = status?.state === 'due' || status?.state === 'countdown' || status?.state === 'handing_off' || status?.state === 'verifying' || status?.state === 'handed_off' || status?.state === 'confirmed'
  const send = async () => {
    setBusy(true)
    try { await api.autoRollover(sessionId, 'now') }
    catch (e) { showToast({ kind: 'error', key: 'autoRollover.requestFailed', detail: safeText(e instanceof Error ? e.message : String(e)) }) }
    finally { setBusy(false) }
  }
  const label = t('autoRollover.request')
  return <button type="button" data-testid="handoff-now" className="vp-control shrink-0" disabled={disabled || busy || underway}
    title={t('autoRollover.requestHint')} aria-label={label} onClick={() => void send()}>
    <ArrowRightLeft size={16} aria-hidden="true" />
    {!compact && <span className="ml-1.5">{label}</span>}
  </button>
}
