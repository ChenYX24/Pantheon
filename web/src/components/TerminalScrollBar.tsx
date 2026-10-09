import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { t, useLang } from '../i18n'
import { dragRows } from './mobile/touchSelect'
import { KEY_SEQUENCES } from './mobile/keys'
import { fullscreenWheel } from './terminalWheel'

/**
 * A fullscreen app owns its transcript and does not expose its total length.
 * This handle therefore pages relative to its resting position and springs
 * back on release; it must not claim a made-up absolute scrollbar percentage.
 * Ordinary terminals keep xterm's actual scrollback slider instead.
 */
export function TerminalScrollBar({ onInput }: { onInput: (data: string) => void }) {
  useLang()
  const railRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef(onInput)
  const drag = useRef<{ pointerId: number; y: number; carry: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  useEffect(() => { inputRef.current = onInput }, [onInput])
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    // Use the same trackpad accumulation as the terminal itself. The parent
    // translates page requests to mouse reports for apps that requested them.
    const wheel = fullscreenWheel(
      () => ({ fullscreen: true, mouseTracking: 'none', replaying: false }),
      (data) => inputRef.current(data),
    )
    rail.addEventListener('wheel', wheel, { passive: false })
    return () => rail.removeEventListener('wheel', wheel)
  }, [])

  const page = (up: boolean, count = 1) =>
    onInput((up ? KEY_SEQUENCES.pageUp : KEY_SEQUENCES.pageDown).repeat(Math.min(3, count)))
  const endDrag = () => {
    drag.current = null
    setOffset(0)
    setDragging(false)
  }

  return (
    <div ref={railRef} className="vp-terminal-scroll" role="group"
      aria-label={t('term.scrollControls')} data-testid="terminal-scrollbar">
      <button type="button" className="vp-terminal-scroll-arrow" data-testid="terminal-scroll-up"
        title={t('term.scrollUp')} aria-label={t('term.scrollUp')}
        onPointerDown={(event) => event.preventDefault()} onClick={() => page(true)}>
        <ChevronUp size={10} aria-hidden="true" />
      </button>
      <div ref={trackRef} className="vp-terminal-scroll-track" onPointerDown={(event) => {
        if (event.target !== event.currentTarget || event.button !== 0) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        page(event.clientY < box.top + box.height / 2)
      }}>
        <button type="button" className="vp-terminal-scroll-handle" data-testid="terminal-scroll-handle"
          data-dragging={dragging ? 'true' : undefined}
          title={t('term.scrollDrag')} aria-label={t('term.scrollDrag')}
          aria-keyshortcuts="ArrowUp ArrowDown PageUp PageDown"
          style={{ transform: `translateY(calc(-50% + ${offset}px))` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            drag.current = { pointerId: event.pointerId, y: event.clientY, carry: 0 }
            event.currentTarget.setPointerCapture(event.pointerId)
            setDragging(true)
          }}
          onPointerMove={(event) => {
            const current = drag.current
            if (!current || current.pointerId !== event.pointerId) return
            const dy = event.clientY - current.y
            const step = dragRows(dy, 24, current.carry)
            current.y = event.clientY
            current.carry = step.carry
            const limit = Math.max(0, ((trackRef.current?.clientHeight ?? 0) - 44) / 2)
            setOffset((value) => Math.max(-limit, Math.min(limit, value + dy)))
            if (step.rows !== 0) page(step.rows < 0, Math.abs(step.rows))
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            endDrag()
          }}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
            if (['ArrowUp', 'PageUp', 'ArrowDown', 'PageDown'].includes(event.key)) {
              event.preventDefault()
              event.stopPropagation()
              page(event.key === 'ArrowUp' || event.key === 'PageUp')
            }
          }} />
      </div>
      <button type="button" className="vp-terminal-scroll-arrow" data-testid="terminal-scroll-down"
        title={t('term.scrollDown')} aria-label={t('term.scrollDown')}
        onPointerDown={(event) => event.preventDefault()} onClick={() => page(false)}>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
    </div>
  )
}
