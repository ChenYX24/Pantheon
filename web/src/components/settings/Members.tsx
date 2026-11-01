import { useEffect, useState } from 'react'
import { CircleCheck, TriangleAlert, Pause } from 'lucide-react'

import { api, errorText } from '../../protocol/api'
import type { PanelMember } from '../../protocol/wire'
import type { HomeIndex } from '../../protocol/home'
import { t, useLang } from '../../i18n'
import { askConfirm } from '../ask'
import { safeText } from '../text'
import { Section } from './parts'

/**
 * The other people with a panel here (docs/pantheon/stage-m-contract.md).
 *
 * Each member signs in at this same address and is sent to a panel of their
 * own, running as their own Linux account. They are created on the server,
 * because creating one makes a Linux account; here the owner sees whether
 * each one's panel is answering, pauses a member, sets a new password, and
 * looks at their projects. The look is read-only and is drawn by this
 * interface from data this panel reads: nothing the member's panel sends is
 * ever a page on this origin.
 */
export function MembersSection() {
  useLang()
  const [members, setMembers] = useState<PanelMember[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const load = async () => {
    try {
      setMembers((await api.members()).members)
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }
  useEffect(() => {
    let cancelled = false
    api.members().then(
      (r) => {
        if (!cancelled) setMembers(r.members)
      },
      (e: unknown) => {
        if (!cancelled) setError(errorText(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async (m: PanelMember) => {
    if (!m.disabled) {
      const yes = await askConfirm({
        title: t('mem.pauseTitle', { name: m.username }),
        body: t('mem.pauseBody'),
        confirm: t('mem.pause'),
        cancel: t('ask.cancel'),
        destructive: true,
      })
      if (!yes) return
    }
    try {
      await api.patchMember(m.id, { disabled: !m.disabled })
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Section id="members" title={t('mem.title')}>
      <div data-testid="members">
        <p className="mb-2 text-vp-base leading-relaxed text-ink-2">{t('mem.why')}</p>
        {error && (
          <p className="mb-2 text-vp-base" style={{ color: 'var(--vp-state-crashed)' }}>
            {safeText(error)}
          </p>
        )}
        {members && members.length === 0 && <p className="text-vp-base text-ink-3">{t('mem.none')}</p>}
        <ul className="flex flex-col gap-2">
          {members?.map((m) => (
            <li key={m.id} data-testid="member-row" className="rounded-vp border border-hairline px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* Shape and word as well as colour (red line 4). */}
                {m.disabled ? (
                  <Pause size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
                ) : m.healthy ? (
                  <CircleCheck size={13} className="shrink-0" style={{ color: 'var(--vp-state-done)' }} aria-hidden="true" />
                ) : (
                  <TriangleAlert size={13} className="shrink-0" style={{ color: 'var(--vp-state-crashed)' }} aria-hidden="true" />
                )}
                <span className="text-vp-base font-medium text-ink">{safeText(m.username)}</span>
                <span className="text-vp-sm text-ink-3">
                  {m.disabled ? t('mem.paused') : m.healthy ? t('mem.up', { version: m.version ?? '' }) : t('mem.down')}
                </span>
                <span className="ml-auto flex shrink-0 gap-2">
                  <button
                    type="button"
                    data-testid="member-view"
                    className="vp-press rounded-vp border border-hairline px-2 py-1 text-vp-sm text-ink-2 hover:text-ink"
                    onClick={() => setOpen(open === m.id ? null : m.id)}
                  >
                    {open === m.id ? t('mem.hide') : t('mem.view')}
                  </button>
                  <button
                    type="button"
                    data-testid="member-toggle"
                    className="vp-press rounded-vp border border-hairline px-2 py-1 text-vp-sm text-ink-2 hover:text-ink"
                    onClick={() => void toggle(m)}
                  >
                    {m.disabled ? t('mem.resume') : t('mem.pause')}
                  </button>
                </span>
              </div>
              {open === m.id && <MemberProjects id={m.id} />}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-vp-sm leading-relaxed text-ink-3">{t('mem.how')}</p>
      </div>
    </Section>
  )
}

/** A member's projects, from their home page, as text. */
function MemberProjects({ id }: { id: string }) {
  const [home, setHome] = useState<HomeIndex | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    api.memberHome(id).then(
      (h) => {
        if (!cancelled) setHome(h as HomeIndex)
      },
      (e: unknown) => {
        if (!cancelled) setError(errorText(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [id])
  if (error) {
    return (
      <p className="mt-2 text-vp-base" style={{ color: 'var(--vp-state-crashed)' }}>
        {safeText(error)}
      </p>
    )
  }
  if (!home) return <p className="mt-2 text-vp-sm text-ink-3">…</p>
  if (!home.available) return <p className="mt-2 text-vp-sm text-ink-3">{safeText(home.reason)}</p>
  if (home.projects.length === 0) return <p className="mt-2 text-vp-sm text-ink-3">{t('mem.noProjects')}</p>
  return (
    <ul data-testid="member-projects" className="mt-2 flex flex-col gap-1.5 border-t border-hairline pt-2">
      {home.projects.map((p) => (
        <li key={p.id} className="text-vp-base">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{safeText(p.id)}</span>
            <span className="text-vp-sm text-ink-3">{safeText(p.status)}</span>
            <span className="text-vp-sm text-ink-3">
              {t('mem.sessions', { n: String(p.sessions.length) })}
            </span>
          </div>
          {p.goal && <p className="text-vp-sm leading-relaxed text-ink-2">{safeText(p.goal)}</p>}
          {p.latestReport && (
            <p className="text-vp-sm leading-relaxed text-ink-3">
              {safeText(p.latestReport.title)}
              {p.latestReport.summary ? ` — ${safeText(p.latestReport.summary)}` : ''}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
