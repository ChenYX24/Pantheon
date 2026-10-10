import { useState } from 'react'
import { Plus, Terminal } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeCreateSession, HomeProject, HomeProjectResources } from '../../protocol/home'
import { panelOpeningSession } from '../../routes'
import { StateDot } from '../StateDot'
import { safeText } from '../text'
import { HomeTime } from './HomeCard'
import { HomeNewSession } from './HomeNewSession'

export function HomeSessions({ project, resources, resourceError, busy, onCreate, onRetry }: { project: HomeProject; resources: HomeProjectResources | null; resourceError: string; busy: boolean; onCreate: (session: HomeCreateSession) => Promise<boolean>; onRetry: () => void }) {
  const [creating, setCreating] = useState<HomeProjectResources | null>(null)
  return <section className="space-y-4" aria-label={t('home.tab.sessions')}>
    <div className="rounded-vp border border-hairline bg-surface p-3">
      <button className="vp-control" type="button" disabled={busy || !resources || !project.pathExists} onClick={() => setCreating(resources)}><Plus size={16} />{t('home.newSession')}</button>
      {!project.pathExists && <p className="mt-2 text-vp-sm text-ink-2">{t('home.noCheckout')}</p>}
      {!resources && !resourceError && <p role="status" className="mt-2 text-vp-sm">{t('home.loading')}</p>}
      {resourceError && <div role="alert" className="mt-2 text-vp-sm"><p>{safeText(resourceError)}</p><button type="button" className="vp-control" onClick={onRetry}>{t('home.retry')}</button></div>}
    </div>
    {!project.sessions.length && <p className="text-ink-2">{t('home.noSessions')}</p>}
    {project.sessions.map((session) => <article key={session.id} className="min-w-0 rounded-vp border border-hairline bg-surface p-3">
      <h3 className="flex items-start gap-2 font-medium"><span className="mt-1.5 shrink-0"><StateDot state={session.state} /></span><span className="min-w-0">{safeText(session.name || session.id)}</span></h3>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-vp-xs text-ink-2"><span>{safeText(session.agent)}</span><HomeTime at={session.stateChangedAt} /></div>
      <a className="vp-control mt-2" href={panelOpeningSession(session.id)}><Terminal size={14} />{t('home.openTerminal')}</a>
    </article>)}
    {creating && <HomeNewSession resources={creating} busy={busy} onCreate={onCreate} onClose={() => setCreating(null)} />}
  </section>
}
