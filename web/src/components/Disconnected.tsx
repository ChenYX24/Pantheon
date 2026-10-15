import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

import { t, useLang } from '../i18n'
import type { PanelSocket } from '../protocol/socket'

/**
 * How long the socket may be down before the panel says so.
 *
 * A reconnect after a laptop wakes, or a phone handing over between networks,
 * is usually under a second. Saying "disconnected" for every one of those
 * would be a banner that flickers past on every wake and teaches people to
 * ignore it.
 */
export const DISCONNECT_GRACE_MS = 3000

/**
 * Whether the panel is disconnected now, given when the socket last left
 * `open` (null while open). A function of numbers so it can be tested.
 */
export function isDisconnected(downSince: number | null, now: number): boolean {
  return downSince !== null && now - downSince >= DISCONNECT_GRACE_MS
}

/**
 * True once the socket has been away for longer than the grace.
 *
 * Starts as not disconnected: the first connect of a page load is "loading",
 * which the boot screen says, not "lost". The clock starts when the socket
 * leaves `open` and is not restarted by the closed/connecting alternation of
 * the retries that follow, or a panel that stayed down would never say so.
 */
export function useDisconnected(socket: Pick<PanelSocket, 'onStatus'>): boolean {
  const [down, setDown] = useState(false)
  useEffect(() => {
    let everOpen = false
    let lostAt: number | null = null
    let timer: number | undefined
    const off = socket.onStatus((s) => {
      if (s === 'open') {
        everOpen = true
        lostAt = null
        window.clearTimeout(timer)
        timer = undefined
        setDown(false)
        return
      }
      if (!everOpen || lostAt !== null) return
      const since = Date.now()
      lostAt = since
      timer = window.setTimeout(() => setDown(isDisconnected(since, Date.now())), DISCONNECT_GRACE_MS)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [socket])
  return down
}

/**
 * The strip that says the panel is not connected.
 *
 * Before it, the only sign was the 6px dot at the far end of the header going
 * hollow: everything else -- the session states, the terminal, the compose
 * box -- went on looking live, and on a phone the open drawer covered the dot.
 * Icon and words, not a colour (red line 4).
 */
export function DisconnectedBar({ className = '' }: { className?: string }) {
  useLang()
  return (
    <div
      role="status"
      data-testid="disconnected"
      className={`flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-1.5 text-vp-base text-ink ${className}`}
      style={{ background: 'var(--vp-surface-2)' }}
    >
      <WifiOff size={15} aria-hidden className="shrink-0" style={{ color: 'var(--vp-state-crashed)' }} />
      <span className="min-w-0">{t('conn.lost')}</span>
    </div>
  )
}
