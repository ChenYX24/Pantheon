import { useState } from 'react'
import { Plus, Terminal } from 'lucide-react'
import { t } from '../../i18n'
import { api } from '../../protocol/api'
import type { HomeCreateSession, HomeProject } from '../../protocol/home'
import type { LaunchProfile } from '../../protocol/wire'
import { panelOpeningSession } from '../../routes'
import { LaunchPicker } from '../LaunchPicker'
import { StateDot } from '../StateDot'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'

export function HomeSessions({ project, busy, onCreate }: { project: HomeProject; busy: boolean; onCreate: (session: HomeCreateSession) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [profiles, setProfiles] = useState<LaunchProfile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const create = async (profileId?: string) => {
    setProfiles(null)
    if (await onCreate({ ...(profileId ? { profileId } : {}), ...(name.trim() ? { name: name.trim() } : {}) })) setName('')
  }
  return <section className="space-y-4" aria-label={t('home.tab.sessions')}>
    <div className="rounded-vp border border-hairline bg-surface p-3">
      <h3 className="mb-3 flex items-center gap-2 font-semibold"><Plus size={16} />{t('home.newSession')}</h3>
      <label className="block text-vp-sm">{t('home.sessionName')}<input className="mt-1 w-full min-w-0 rounded-vp border border-hairline bg-surface px-3 py-2 text-vp-base text-ink" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="vp-control" type="button" disabled={busy || loading || !project.pathExists} onClick={async () => {
          setLoading(true); setError('')
          try {
            const items = await api.launchProfiles()
            if (items.length) setProfiles(items)
            else setError(t('home.noProfiles'))
          } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
        }}><Terminal size={15} />{loading ? t('home.loading') : t('home.chooseProfile')}</button>
        <button className="vp-control" type="button" disabled={busy || loading || !project.pathExists} onClick={() => void create()}>{t('home.plainShell')}</button>
      </div>
      {!project.pathExists && <p className="mt-2 text-vp-sm text-ink-2">{t('home.noCheckout')}</p>}
      {error && <p role="alert" className="mt-2 text-vp-sm">{safeText(error)}</p>}
    </div>
    {!project.sessions.length && <p className="text-ink-2">{t('home.noSessions')}</p>}
    {project.sessions.map((session) => <article key={session.id} className="min-w-0 rounded-vp border border-hairline bg-surface p-3">
      <h3 className="flex items-start gap-2 font-medium"><span className="mt-1.5 shrink-0"><StateDot state={session.state} /></span><span className="min-w-0">{safeText(session.name || session.id)}</span></h3>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-vp-xs text-ink-2"><span>{safeText(session.agent)}</span><HomeTime at={session.stateChangedAt} /></div>
      <a className="vp-control mt-2" href={panelOpeningSession(session.id)}><Terminal size={14} />{t('home.openTerminal')}</a>
    </article>)}
    {profiles && <LaunchPicker profiles={profiles} onPick={(id) => void create(id)} onClose={() => setProfiles(null)} />}
  </section>
}
