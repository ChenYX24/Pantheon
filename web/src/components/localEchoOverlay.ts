import type { Terminal } from '@xterm/xterm'
import type { PanelSocket } from '../protocol/socket'
import { LocalEcho } from './localEcho'
import type { EchoState } from './localEcho'
import { localEchoPreference, onLocalEchoPreference } from './localEchoPreference'

/** The same CSS cell dimensions FitAddon.proposeDimensions reads. */
export function echoCellSize(term: unknown): { width: number; height: number } | null {
  const cell = (term as {
    _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } }
  })?._core?._renderService?.dimensions?.css?.cell
  // An xterm upgrade must disable prediction if this private API moves, not
  // make input throw or put guessed characters at unrelated screen positions.
  return cell && Number.isFinite(cell.width) && Number.isFinite(cell.height) && cell.width > 0 && cell.height > 0
    ? { width: cell.width, height: cell.height } : null
}

/** Owns only a disposable DOM layer; all terminal writes still come from the server. */
export function attachLocalEcho(
  term: Terminal,
  host: HTMLElement,
  socket: PanelSocket,
  state: () => Omit<EchoState, 'composing'>,
) {
  const engine = new LocalEcho()
  const overlay = document.createElement('div')
  overlay.className = 'vp-local-echo'
  overlay.dataset.testid = 'local-echo-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  const screen = term.element?.querySelector('.xterm-screen')
  screen?.append(overlay)
  let composing = false
  let pasting = false
  let disposed = false
  let deadline: number | null = null
  let rttMs = socket.getLatency()?.rttMs ?? null
  let mode = localEchoPreference()

  const context = (): EchoState => {
    const current = state()
    return {
      ...current,
      composing: composing || pasting,
      controlling: current.controlling && (!host.style.transform || host.style.transform === 'none'),
      hidden: current.hidden || document.visibilityState !== 'visible' || !host.contains(document.activeElement),
    }
  }

  const draw = () => {
    if (disposed) return
    if (deadline !== null) window.clearTimeout(deadline)
    deadline = null
    const now = performance.now()
    const predictions = engine.visible(now, rttMs, mode)
    if (predictions.length || overlay.childElementCount) {
      const cell = echoCellSize(term)
      const buffer = term.buffer.active
      overlay.style.fontFamily = term.options.fontFamily ?? ''
      overlay.style.fontSize = `${term.options.fontSize}px`
      overlay.style.fontWeight = String(term.options.fontWeight ?? 'normal')
      overlay.replaceChildren(...(cell ? predictions.map((prediction) => {
        const span = document.createElement('span')
        span.textContent = prediction.char
        span.style.left = `${prediction.col * cell.width}px`
        span.style.top = `${(prediction.row - buffer.viewportY) * cell.height}px`
        span.style.width = `${cell.width}px`
        span.style.height = `${cell.height}px`
        span.style.lineHeight = `${cell.height}px`
        return span
      }) : []))
    }
    const due = engine.deadline(rttMs)
    if (due !== null) deadline = window.setTimeout(draw, Math.max(1, due - now))
  }

  const reset = () => { engine.reset(); draw() }
  const input = (data: string) => {
    engine.input(data, term, context(), performance.now(), rttMs, mode)
    draw()
  }
  const parsed = term.onWriteParsed(() => {
    engine.parsed(term, context(), performance.now(), rttMs)
    draw()
  })
  const resized = term.onResize(reset)
  const scrolled = term.onScroll(reset)
  const bufferChanged = term.buffer.onBufferChange(reset)
  const rendered = term.onRender(draw)
  const offLatency = socket.onLatency((latency) => { rttMs = latency?.rttMs ?? null; draw() })
  const offStatus = socket.onStatus((status) => { if (status !== 'open') reset() })
  const offPreference = onLocalEchoPreference(() => {
    const next = localEchoPreference()
    if (next === mode) return
    mode = next
    reset()
  })

  const startComposition = () => { composing = true; reset() }
  const keydown = (event: KeyboardEvent) => {
    // CompositionHelper sends the commit after compositionend. Keep that
    // commit silent too, until the next ordinary key starts fresh input.
    composing = event.isComposing || event.keyCode === 229
    if (composing) reset()
  }
  const paste = () => {
    pasting = true
    reset()
    // A one-character paste is still a paste. Capture runs before xterm's
    // synchronous paste handler; the flag survives all of that event's data.
    queueMicrotask(() => { pasting = false })
  }
  const beforeInput = (event: Event) => {
    const input = event as InputEvent
    if (input.isComposing || input.inputType.includes('Composition')) startComposition()
    if (input.inputType === 'insertFromPaste') paste()
  }
  host.addEventListener('compositionstart', startComposition, true)
  host.addEventListener('compositionend', startComposition, true)
  host.addEventListener('keydown', keydown, true)
  host.addEventListener('beforeinput', beforeInput, true)
  host.addEventListener('paste', paste, { capture: true, passive: true })
  host.addEventListener('focusout', reset)
  document.addEventListener('visibilitychange', reset)

  return {
    input,
    reset,
    dispose() {
      disposed = true
      if (deadline !== null) window.clearTimeout(deadline)
      parsed.dispose()
      resized.dispose()
      scrolled.dispose()
      bufferChanged.dispose()
      rendered.dispose()
      offLatency()
      offStatus()
      offPreference()
      host.removeEventListener('compositionstart', startComposition, true)
      host.removeEventListener('compositionend', startComposition, true)
      host.removeEventListener('keydown', keydown, true)
      host.removeEventListener('beforeinput', beforeInput, true)
      host.removeEventListener('paste', paste, true)
      host.removeEventListener('focusout', reset)
      document.removeEventListener('visibilitychange', reset)
      engine.reset()
      overlay.remove()
    },
  }
}
