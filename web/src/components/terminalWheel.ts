interface ScrollState {
  fullscreen: boolean
  mouseTracking: string
  replaying: boolean
}

/**
 * tmux draws into xterm's normal buffer even when the pane uses the alternate
 * screen. An app without mouse reporting therefore cannot see a wheel, and
 * xterm cannot apply alternate-screen scrolling either. Codex 0.159.2 hits
 * this path because it disables mouse capture when tmux's mouse option is off.
 *
 * Page keys reach its transcript without Up/Down changing the composer draft.
 * Mouse-reporting apps retain their protocol; Shift+wheel retains access to
 * the browser's own scrollback. Never synthesize keys while replaying output.
 */
export function fullscreenWheel(
  state: () => ScrollState,
  send: (data: string) => void,
): (event: WheelEvent) => void {
  let carried = 0
  let lastAt = 0
  return (event) => {
    const current = state()
    if (!current.fullscreen || current.mouseTracking !== 'none'
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || !Number.isFinite(event.deltaY) || event.deltaY === 0
      || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      carried = 0
      return
    }
    // Capture before xterm's wheel listener, so one gesture has one owner.
    event.preventDefault()
    event.stopImmediatePropagation()
    if (current.replaying) {
      carried = 0
      return
    }
    const delta = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 120 : 1)
    if (event.timeStamp - lastAt > 250 || Math.sign(carried) !== Math.sign(delta)) carried = 0
    lastAt = event.timeStamp
    carried += delta
    const pages = Math.min(3, Math.floor(Math.abs(carried) / 120))
    if (pages === 0) return
    send((carried < 0 ? '\x1b[5~' : '\x1b[6~').repeat(pages))
    // Bound a large wheel burst; do not defer extra pages to another gesture.
    carried %= 120
  }
}
