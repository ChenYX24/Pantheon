import { useEffect, useRef, useState } from 'react'
import { api } from '../protocol/api'
import type { RolloverStatus } from '../protocol/wire'
import { t } from '../i18n'
import { panelOpeningSession } from '../routes'
import { askConfirm } from './ask'
import { Menu } from './Menu'
import { rolloverActive } from './rollover'
import { safeText } from './text'

export function RolloverActions({ id, menu = false, onlyResume = false, disabled = false, reason = 'manual' }: { id: string; menu?: boolean; onlyResume?: boolean; disabled?: boolean; reason?: 'manual' | 'long' }) {
  const [status, setStatus] = useState<RolloverStatus | null>(null)
  const statusRef = useRef<RolloverStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => {
    let stopped = false
    let pending = false
    let active = busy || rolloverActive(statusRef.current)
    let timer = 0
    const poll = async () => {
      if (stopped || pending || document.hidden) return
      pending = true
      window.clearTimeout(timer)
      try {
        const next = await api.rolloverStatus(id)
        if (stopped) return
        active = busy || rolloverActive(next)
        const previous = statusRef.current
        if (!previous || previous.state !== next.state || previous.handoff !== next.handoff
          || previous.startedAt !== next.startedAt || previous.error !== next.error
          || previous.newSessionId !== next.newSessionId) {
          statusRef.current = next
          setStatus(next)
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e))
      } finally {
        pending = false
        if (!stopped && !document.hidden && active) timer = window.setTimeout(() => void poll(), 2000)
      }
    }
    const visible = () => {
      if (document.hidden) window.clearTimeout(timer)
      else void poll()
    }
    document.addEventListener('visibilitychange', visible)
    void poll()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
    // Starting and finishing an action each need a fresh read; idle headers
    // otherwise read only on mount and on returning to the page.
  }, [id, busy])
  const active = busy || rolloverActive(status)
  const blocked = disabled || active || status?.state === 'done'
  const start = async (resume: boolean) => {
    if (!(await askConfirm({ title: t(resume ? 'rollover.resume' : 'rollover.end'), body: t('rollover.confirm'), confirm: t(resume ? 'rollover.resume' : 'rollover.end'), cancel: t('res.cancel'), destructive: true }))) return
    setBusy(true)
    setError('')
    try {
      await api.rolloverSession(id, resume, reason)
      const next = await api.rolloverStatus(id)
      setStatus(next)
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const items = (onlyResume ? [true] : [false, true]).map((resume) => ({ label: t(resume ? 'rollover.resume' : 'rollover.end'), disabled: blocked, onSelect: () => void start(resume), testid: resume ? 'rollover-resume' : 'rollover-end' }))
  return <span className="inline-flex min-w-0 flex-wrap items-center gap-2" data-testid="rollover-actions">
    {menu ? <Menu items={items} /> : items.map((item) => <button key={item.testid} type="button" className="vp-control" disabled={item.disabled} onClick={item.onSelect}>{item.label}</button>)}
    {status && status.state !== 'idle' && <span role="status" className="text-vp-xs text-ink-2" title={status.handoff}>{t(`rollover.state.${status.state}`)}</span>}
    {status?.newSessionId && <a className="vp-control" href={panelOpeningSession(status.newSessionId)}>{t('rollover.open')}</a>}
    {(error || status?.error) && <span role="alert" className="text-vp-xs text-state-crashed">{safeText(error || status?.error || '')}</span>}
  </span>
}
