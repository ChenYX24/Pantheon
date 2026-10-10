import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { t } from '../../i18n'
import { safeText } from '../text'

export function HomeDialog({ title, onClose, children, anchor }: {
  title: string
  onClose: () => void
  children: ReactNode
  anchor?: { top: number; left: number }
}) {
  const id = useId()
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || document.querySelector('[data-vp-modal="confirm"]')) return
      if ([...document.querySelectorAll('[data-vp-modal="home"]')].at(-1) !== panel.current) return
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key !== 'Tab') return
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length)
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [])

  return createPortal(<div className="vp-backdrop @container fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-2" onClick={onClose}>
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} data-vp-modal="home" className={`vp-panel-in @container flex max-h-[85dvh] min-w-0 flex-col overflow-hidden rounded-vp-lg border border-hairline bg-surface text-ink shadow-xl @3xl:self-center [overflow-wrap:anywhere] ${anchor ? 'fixed w-72 max-w-[calc(100vw-1rem)]' : 'w-full max-w-2xl'}`} style={anchor} onClick={(event) => event.stopPropagation()}>
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-3"><h2 id={id} className="min-w-0 flex-1 font-semibold">{safeText(title)}</h2><button type="button" className="vp-control" onClick={onClose} title={t('home.close')}><X size={16} /></button></header>
      <div className="vp-safe-bottom min-h-0 overflow-y-auto p-4">{children}</div>
    </section>
  </div>, document.body)
}
