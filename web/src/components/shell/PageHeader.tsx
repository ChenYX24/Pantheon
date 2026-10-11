import { useContext, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { t } from '../../i18n'
import { HomeDialog } from '../home/HomeDialog'
import { ShellSettings } from './ShellSettings'

export function PageHeader({ title, subtitle, breadcrumb, status, actions, secondary }: { title: string; subtitle?: ReactNode; breadcrumb?: ReactNode; status?: ReactNode; actions?: ReactNode; secondary?: ReactNode }) {
  const settings = useContext(ShellSettings)
  const [open, setOpen] = useState(false)
  return <header className="shell-page-header">
    {breadcrumb && <nav className="shell-breadcrumb" aria-label={t('home.shell.breadcrumb')}>{breadcrumb}</nav>}
    <div className="shell-page-heading">
      <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><h1 className="shell-title truncate" title={title}>{title}</h1>{status}</div>{subtitle && <p className="shell-subtitle" title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</p>}</div>
      <div className="shell-header-actions">{actions}</div>
      <button type="button" className={`vp-control ${secondary ? '' : 'shell-phone-only'}`} aria-label={t('home.shell.more')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><MoreHorizontal size={18} /><span className="shell-desktop-only">{t('home.shell.more')}</span></button>
    </div>
    {open && <HomeDialog title={t('home.shell.more')} onClose={() => setOpen(false)}><div className="shell-menu" onClick={(event) => { if ((event.target as HTMLElement).closest('button, a')) setOpen(false) }}>
      <div className="shell-phone-only shell-menu">{actions}</div>{secondary}
    </div><div className="shell-phone-only shell-mobile-settings">{settings}</div></HomeDialog>}
  </header>
}
