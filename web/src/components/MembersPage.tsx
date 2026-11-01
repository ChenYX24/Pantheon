import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, LogOut } from 'lucide-react'

import { t, useLang } from '../i18n'
import type { AuthState } from '../protocol/wire'
import { PANEL_PATH } from '../routes'
import { Mark } from './AuthGate'
import { ConfirmDialog } from './ConfirmDialog'
import { LanguageSwitch } from './LanguageSwitch'
import { ThemeToggle } from './ThemeToggle'
import { Members } from './members/Members'
import { safeText } from './text'
import { applyTheme, loadTheme } from './theme'
import type { ThemeChoice } from './theme'

/**
 * The other people with a panel on this machine (stage-m-contract.md), and
 * everything the owner does about them: add, pause, a new password, a Claude
 * grant, a restart, and a look at their projects and sessions.
 *
 * A page and not a settings section, for the reason Sharing became one: each
 * member is a card with its own forms unfolding under it, and a dialog whose
 * body is a third of the window is the wrong container for that.
 */
export function MembersPage({ auth, onSignOut }: { auth: AuthState; onSignOut: () => void }) {
  useLang()
  const [theme, setThemeState] = useState<ThemeChoice>(loadTheme)
  const setTheme = useCallback((next: ThemeChoice) => {
    applyTheme(next)
    setThemeState(next)
  }, [])

  useEffect(() => {
    document.title = `${t('mem.title')} · vibepanel`
  })

  return (
    <div data-testid="members-page" className="h-full w-full overflow-y-auto bg-bg text-ink">
      <header className="vp-blur vp-safe-pad-top sticky top-0 z-10 border-b border-hairline">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
          <a href={PANEL_PATH} data-testid="members-back" title={t('sharing.back')} className="vp-control vp-press gap-1.5 pr-2">
            <ArrowLeft size={15} />
            <Mark small />
          </a>
          <span className="flex min-w-0 items-center gap-1.5 text-vp-md">
            <span className="font-semibold tracking-tight text-ink">vibepanel</span>
            <span className="text-ink-3" aria-hidden="true">
              /
            </span>
            <span className="truncate text-ink-2">{t('mem.title')}</span>
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <LanguageSwitch testid="members" />
            <ThemeToggle theme={theme} onChange={setTheme} />
            <button
              type="button"
              data-testid="sign-out"
              onClick={onSignOut}
              title={t('app.signedInAs', { user: safeText(auth.username ?? '?') })}
              className="vp-control"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="vp-safe-bottom mx-auto max-w-4xl px-4 pt-6 [--vp-safe-pad:2.5rem] sm:px-6 sm:pt-8">
        {auth.member ? <p className="text-vp-base text-ink-2">{t('mem.ownerOnly')}</p> : <Members />}
      </main>
      <ConfirmDialog />
    </div>
  )
}
