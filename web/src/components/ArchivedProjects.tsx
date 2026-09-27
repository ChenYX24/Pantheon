import { useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Trash2, X } from 'lucide-react'

import type { ArchivedProject } from '../protocol/wire'
import { safeText } from './text'
import { StateDot } from './StateDot'
import { formatAgo } from './panels/ago'
import { t, useLang } from '../i18n'

/**
 * The projects that are not in the sidebar.
 *
 * Reached from the one line under the last project, which is only there when
 * something has been archived. Each row says when it went and whether a person
 * or the idle rule sent it, because the question somebody arrives here with is
 * "where did that project go".
 *
 * Deleting is here as well as restoring: the usual reason to look at an old
 * project is to decide it is finished, and making somebody restore it first,
 * so it can be deleted from the sidebar, is two steps for one decision.
 */
export function ArchivedProjects({
  archived,
  onRestore,
  onRemove,
  onClose,
}: {
  archived: ArchivedProject[]
  onRestore: (p: ArchivedProject) => Promise<void>
  onRemove: (p: ArchivedProject) => Promise<void>
  onClose: () => void
}) {
  useLang()
  const [busy, setBusy] = useState<string | null>(null)
  // When the dialog opened. Relative times that drift a minute while it is up
  // are not worth a timer.
  const [now] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Deleting asks first, in a dialog over this one, and that dialog
      // answers Escape itself. Without this one Escape closed both, and the
      // list somebody was working through went with the question.
      if (document.querySelector('[data-vp-modal="confirm"]')) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="vp-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      data-testid="archived-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('archive.title')}
        // Read by focusTerminal and the other dialogs: while this is up the
        // keyboard is its, not the terminal's underneath.
        data-vp-modal="archived"
        className="vp-panel-in flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-vp border border-hairline bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="archived-dialog"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2.5">
          <Archive size={14} className="shrink-0 text-ink-2" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-vp-md font-semibold">{t('archive.title')}</span>
          <button
            type="button"
            onClick={onClose}
            title={t('ask.cancel')}
            className="vp-control vp-tap"
            data-testid="archived-close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {archived.length === 0 && (
            <p className="px-4 py-6 text-vp-base text-ink-2">{t('archive.empty')}</p>
          )}
          {archived.map((p) => (
            <div
              key={p.id}
              data-testid="archived-row"
              className="flex items-start gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="min-w-0 truncate text-vp-md font-semibold text-ink">
                  {safeText(p.name)}
                </div>
                <div className="mt-0.5 min-w-0 truncate font-mono text-vp-sm text-ink-2" title={p.path}>
                  {safeText(p.path)}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-vp-sm text-ink-2">
                  <span>
                    {t(p.archivedAuto ? 'archive.whenAuto' : 'archive.when', {
                      ago: formatAgo(p.archivedAt, now),
                    })}
                  </span>
                  {p.sessions > 0 && (
                    <span data-testid="archived-running">
                      {p.sessions === 1 ? t('archive.runningOne') : t('archive.runningMany', { n: p.sessions })}
                    </span>
                  )}
                  {p.waiting > 0 && (
                    <span className="inline-flex items-center gap-1" data-testid="archived-row-waiting">
                      <StateDot state="waiting" />
                      {t('archive.waiting', { n: p.waiting })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(p.id, () => onRestore(p))}
                  data-testid="archived-restore"
                  className="vp-press inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-vp-sm text-ink transition-colors duration-150 ease-vp hover:bg-surface-2 disabled:opacity-50"
                >
                  <ArchiveRestore size={13} aria-hidden="true" />
                  {t('archive.restore')}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(p.id, () => onRemove(p))}
                  data-testid="archived-remove"
                  title={t('project.remove')}
                  className="vp-control vp-tap disabled:opacity-50"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
