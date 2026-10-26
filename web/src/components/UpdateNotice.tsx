import { RefreshCw } from 'lucide-react'
import { t, useLang } from '../i18n'
import { isOutdated } from './bundle'

/**
 * Say so when the panel was upgraded under an open page.
 *
 * The page keeps running the interface it loaded, against a server that has
 * moved on, and nothing on screen says so: after R3 went out, a tab opened the
 * day before had no handoff button and no context meter, and looked like a
 * release that had not worked. A button and not a reload, because whoever is
 * looking may be halfway through typing into a terminal.
 */
export function UpdateNotice({ served, own }: { served: string; own: string }) {
  useLang()
  if (!isOutdated(served, own)) return null
  return (
    <div
      data-testid="update-notice"
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-4 py-2 text-vp-base text-ink"
      style={{ background: 'var(--vp-surface-2)' }}
    >
      <span>{t('app.updated')}</span>
      <button
        type="button"
        data-testid="update-reload"
        className="vp-outline inline-flex items-center gap-1 text-vp-sm"
        onClick={() => window.location.reload()}
      >
        <RefreshCw size={13} aria-hidden="true" />
        {t('app.reload')}
      </button>
    </div>
  )
}
