import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, Pause, TriangleAlert, UserPlus } from 'lucide-react'

import { api, errorText } from '../../protocol/api'
import type { MemberSystem, PanelMember, PanelState } from '../../protocol/wire'
import type { HomeIndex } from '../../protocol/home'
import { t, useLang } from '../../i18n'
import { askConfirm } from '../ask'
import { StateDot } from '../StateDot'
import { safeText } from '../text'

/**
 * The members, and what the owner does about each (stage-m-contract.md).
 *
 * Two sources, read side by side: the panel's own list (who can sign in, and
 * whether their panel answers) and pantheon-member's status (what root knows:
 * the unit, the memory their sessions use, whether Claude is granted). The
 * second needs sudo; without it the list still works and the page says what
 * to run on the server instead of offering buttons that would fail.
 *
 * What a member's panel says is shown here as text this interface draws.
 * Nothing it sends is ever a page on this origin.
 */
export function Members() {
  useLang()
  const [members, setMembers] = useState<PanelMember[] | null>(null)
  const [system, setSystem] = useState<MemberSystem | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [list, sys] = await Promise.all([api.members(), api.memberSystem()])
      setMembers(list.members)
      setSystem(sys)
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.members(), api.memberSystem()]).then(
      ([list, sys]) => {
        if (cancelled) return
        setMembers(list.members)
        setSystem(sys)
      },
      (e: unknown) => {
        if (!cancelled) setError(errorText(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const root = system?.available === true
  return (
    <div data-testid="members">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-vp-lg font-semibold tracking-tight text-ink">{t('mem.title')}</h1>
          <p className="mt-1 text-vp-base leading-relaxed text-ink-2">{t('mem.why')}</p>
        </div>
        <button
          type="button"
          data-testid="member-add-open"
          disabled={!root}
          onClick={() => setAdding(!adding)}
          className="vp-press inline-flex shrink-0 items-center gap-1.5 rounded-vp px-3 py-1.5 text-vp-base disabled:opacity-50"
          style={{ background: 'var(--vp-accent)', color: 'var(--vp-accent-ink)' }}
        >
          <UserPlus size={14} aria-hidden="true" />
          {t('mem.add')}
        </button>
      </div>

      {system && !system.available && (
        <div data-testid="members-no-root" className="mb-4 rounded-vp border border-hairline bg-surface-2 p-3 text-vp-base text-ink-2">
          <p>{t('mem.noRoot')}</p>
          <p className="mt-1 font-mono text-vp-sm text-ink-3">{safeText(system.reason ?? '')}</p>
          <p className="mt-2 font-mono text-vp-sm text-ink">{t('mem.how')}</p>
        </div>
      )}
      {error && <ErrorLine text={error} />}
      {adding && root && (
        <AddMember
          onDone={() => {
            setAdding(false)
            void reload()
          }}
        />
      )}

      {members && members.length === 0 && <p className="text-vp-base text-ink-3">{t('mem.none')}</p>}
      <ul className="flex flex-col gap-3">
        {members?.map((m) => (
          <MemberCard key={m.id} member={m} fact={system?.members[m.linuxUser]} root={root} onChanged={() => void reload()} />
        ))}
      </ul>
    </div>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p className="mb-2 text-vp-base break-words" style={{ color: 'var(--vp-state-crashed)' }}>
      {safeText(text)}
    </p>
  )
}

const inputClass =
  'min-w-0 flex-1 rounded-vp border border-hairline bg-surface px-2 py-1.5 text-vp-base text-ink outline-none focus:border-[var(--vp-accent)]'
const quietButton =
  'vp-press shrink-0 rounded-vp border border-hairline px-2.5 py-1.5 text-vp-sm text-ink-2 hover:text-ink disabled:opacity-50'

function AddMember({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api.provisionMember(name.trim(), password)
      onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-testid="member-add" className="mb-4 rounded-vp border border-hairline bg-surface-2 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          data-testid="member-add-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('mem.name')}
          autoComplete="off"
          className={inputClass}
        />
        <input
          data-testid="member-add-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('mem.password')}
          autoComplete="new-password"
          className={inputClass}
        />
        <button
          type="button"
          data-testid="member-add-submit"
          disabled={busy || !name.trim() || password.length < 12}
          onClick={() => void submit()}
          className="vp-press shrink-0 rounded-vp px-3 py-1.5 text-vp-base disabled:opacity-50"
          style={{ background: 'var(--vp-accent)', color: 'var(--vp-accent-ink)' }}
        >
          {busy ? t('mem.adding') : t('mem.create')}
        </button>
      </div>
      <p className="mt-2 text-vp-sm text-ink-3">{t('mem.addWhy')}</p>
      {error && <ErrorLine text={error} />}
    </div>
  )
}

function mib(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GiB`
  return `${Math.round(bytes / (1 << 20))} MiB`
}

function MemberCard({
  member: m,
  fact,
  root,
  onChanged,
}: {
  member: PanelMember
  fact?: MemberSystem['members'][string]
  root: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<'password' | 'claude' | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      setForm(null)
      setValue('')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const togglePause = async () => {
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
    await run(() => api.patchMember(m.id, { disabled: !m.disabled }))
  }

  const remove = async () => {
    const yes = await askConfirm({
      title: t('mem.removeTitle', { name: m.username }),
      body: t('mem.removeBody'),
      confirm: t('mem.remove'),
      cancel: t('ask.cancel'),
      destructive: true,
    })
    if (yes) await run(() => api.removeMember(m.id))
  }

  const submitForm = () =>
    run(() => (form === 'password' ? api.patchMember(m.id, { password: value }) : api.grantMemberClaude(m.id, value.trim())))

  return (
    <li data-testid="member-row" className="rounded-vp border border-hairline px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Shape and word as well as colour (red line 4). */}
        {m.disabled ? (
          <Pause size={14} className="shrink-0 text-ink-3" aria-hidden="true" />
        ) : m.healthy ? (
          <CircleCheck size={14} className="shrink-0" style={{ color: 'var(--vp-state-done)' }} aria-hidden="true" />
        ) : (
          <TriangleAlert size={14} className="shrink-0" style={{ color: 'var(--vp-state-crashed)' }} aria-hidden="true" />
        )}
        <span className="text-vp-md font-medium text-ink">{safeText(m.username)}</span>
        <span data-testid="member-status" className="text-vp-sm text-ink-3">
          {m.disabled ? t('mem.paused') : m.healthy ? t('mem.up', { version: m.version ?? '' }) : t('mem.down')}
        </span>
      </div>

      <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-vp-sm text-ink-2">
        {fact && fact.memoryMax > 0 && (
          <div className="flex gap-1.5">
            <dt className="text-ink-3">{t('mem.memory')}</dt>
            <dd data-testid="member-memory" className="tabular">
              {mib(fact.memoryCurrent)} / {mib(fact.memoryMax)}
            </dd>
          </div>
        )}
        {fact && (
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Claude</dt>
            <dd data-testid="member-claude">{fact.claude ? t('mem.claudeGranted') : t('mem.claudeOwn')}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="text-ink-3">{t('mem.address')}</dt>
          <dd className="font-mono">{safeText(m.upstream)}</dd>
        </div>
      </dl>

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" data-testid="member-view" className={quietButton} onClick={() => setOpen(!open)}>
          {open ? t('mem.hide') : t('mem.view')}
        </button>
        <button type="button" data-testid="member-toggle" disabled={busy} className={quietButton} onClick={() => void togglePause()}>
          {m.disabled ? t('mem.resume') : t('mem.pause')}
        </button>
        <button
          type="button"
          data-testid="member-password"
          disabled={busy}
          className={quietButton}
          onClick={() => setForm(form === 'password' ? null : 'password')}
        >
          {t('mem.setPassword')}
        </button>
        {root && fact && !fact.claude && (
          <button
            type="button"
            data-testid="member-claude-grant"
            disabled={busy}
            className={quietButton}
            onClick={() => setForm(form === 'claude' ? null : 'claude')}
          >
            {t('mem.grantClaude')}
          </button>
        )}
        {root && fact?.claude && (
          <button
            type="button"
            data-testid="member-claude-revoke"
            disabled={busy}
            className={quietButton}
            onClick={() => void run(() => api.revokeMemberClaude(m.id))}
          >
            {t('mem.revokeClaude')}
          </button>
        )}
        {root && (
          <button
            type="button"
            data-testid="member-restart"
            disabled={busy}
            className={quietButton}
            onClick={() => void run(() => api.restartMember(m.id))}
          >
            {t('mem.restart')}
          </button>
        )}
        {root && (
          <button type="button" data-testid="member-remove" disabled={busy} className={quietButton} onClick={() => void remove()}>
            {t('mem.remove')}
          </button>
        )}
      </div>

      {form && (
        <div data-testid="member-form" className="mt-2 flex flex-wrap gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={form === 'password' ? t('mem.password') : t('mem.claudeToken')}
            autoComplete={form === 'password' ? 'new-password' : 'off'}
            className={inputClass}
          />
          <button
            type="button"
            data-testid="member-form-submit"
            disabled={busy || (form === 'password' ? value.length < 12 : !value.trim())}
            onClick={() => void submitForm()}
            className="vp-press shrink-0 rounded-vp px-3 py-1.5 text-vp-base disabled:opacity-50"
            style={{ background: 'var(--vp-accent)', color: 'var(--vp-accent-ink)' }}
          >
            {t('mem.save')}
          </button>
          {form === 'claude' && <p className="w-full text-vp-sm text-ink-3">{t('mem.claudeHow')}</p>}
        </div>
      )}
      {error && <ErrorLine text={error} />}
      {open && <MemberDetail id={m.id} />}
    </li>
  )
}

/** A member's projects and sessions, read by this panel from theirs. */
function MemberDetail({ id }: { id: string }) {
  const [home, setHome] = useState<HomeIndex | null>(null)
  const [state, setState] = useState<PanelState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    Promise.all([api.memberHome(id), api.memberState(id)]).then(
      ([h, s]) => {
        if (cancelled) return
        setHome(h as HomeIndex)
        setState(s)
      },
      (e: unknown) => {
        if (!cancelled) setError(errorText(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [id])
  if (error) return <ErrorLine text={error} />
  if (!home || !state) return <p className="mt-2 text-vp-sm text-ink-3">…</p>
  const names = new Map(state.projects.map((p) => [p.id, p.name]))
  return (
    <div data-testid="member-detail" className="mt-3 grid gap-3 border-t border-hairline pt-3">
      <section>
        <h3 className="mb-1 text-vp-sm font-semibold tracking-wide text-ink-2 uppercase">{t('mem.sessionsTitle')}</h3>
        {state.sessions.length === 0 ? (
          <p className="text-vp-sm text-ink-3">{t('mem.noSessions')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {state.sessions.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-2 text-vp-base">
                <StateDot state={s.state} />
                <span className="min-w-0 truncate text-ink">{safeText(s.title)}</span>
                <span className="shrink-0 text-vp-sm text-ink-3">{safeText(names.get(s.projectId) ?? '')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-vp-sm font-semibold tracking-wide text-ink-2 uppercase">{t('mem.projectsTitle')}</h3>
        {!home.available || home.projects.length === 0 ? (
          <p className="text-vp-sm text-ink-3">
            {state.projects.length === 0
              ? t('mem.noProjects')
              : state.projects.map((p) => safeText(p.name)).join(' · ')}
          </p>
        ) : (
          <ul data-testid="member-projects" className="flex flex-col gap-1.5">
            {home.projects.map((p) => (
              <li key={p.id} className="text-vp-base">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{safeText(p.id)}</span>
                  <span className="text-vp-sm text-ink-3">{safeText(p.status)}</span>
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
        )}
      </section>
    </div>
  )
}
