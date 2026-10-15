export type LocalEchoMode = 'auto' | 'off' | 'on'

export interface EchoState {
  controlling: boolean
  readOnly: boolean
  replaying: boolean
  fullscreen: boolean
  composing: boolean
  hidden: boolean
}

/** Read access only. A prediction must never become terminal output. */
export interface EchoTerminal {
  cols: number
  buffer: {
    active: {
      type: 'normal' | 'alternate'
      baseY: number
      viewportY: number
      cursorX: number
      cursorY: number
      getLine(row: number): {
        getCell(col: number): { getChars(): string; getWidth(): number } | undefined
      } | undefined
    }
  }
}

export interface Prediction {
  /** Absolute buffer row, not the row in a scrolled viewport. */
  row: number
  col: number
  char: string
  at: number
  /** Silent input stays silent even if a later confirmation builds confidence. */
  display: boolean
}

const AUTO_RTT_MS = 60
const CONFIDENCE_MS = 5_000

function allowed(term: EchoTerminal, state: EchoState): boolean {
  const buffer = term.buffer.active
  return state.controlling && !state.readOnly && !state.replaying && !state.fullscreen
    && !state.composing && !state.hidden && buffer.type === 'normal' && buffer.viewportY === buffer.baseY
}

/**
 * Predict only an ASCII suffix on a known grid. Editing existing text, wrapping
 * and wide cells need a line editor's model; guessing there paints the wrong
 * thing even when the transport delivers every byte correctly.
 */
export class LocalEcho {
  private queue: Prediction[] = []
  private confirmedAt: number | null = null

  get pending(): readonly Prediction[] { return this.queue }

  reset(): void {
    this.queue = []
    this.confirmedAt = null
  }

  private canDisplay(now: number, rttMs: number | null, mode: LocalEchoMode): boolean {
    return mode !== 'off' && (mode === 'on' || (rttMs ?? 0) > AUTO_RTT_MS)
      && this.confirmedAt !== null && now - this.confirmedAt < CONFIDENCE_MS
  }

  input(data: string, term: EchoTerminal, state: EchoState, now: number, rttMs: number | null, mode: LocalEchoMode): void {
    this.expire(now, rttMs)
    if (mode === 'off' || !allowed(term, state)) {
      this.reset()
      return
    }
    if (data === '\x7f' || data === '\b') {
      this.queue.pop()
      if (!this.queue.length) this.reset()
      return
    }
    if (!/^[\x20-\x7e]$/.test(data)) {
      // Enter and cursor commands can leave an echoing shell at a password
      // prompt. Confidence must not cross that boundary, even in Always on.
      this.reset()
      return
    }
    const buffer = term.buffer.active
    const row = buffer.baseY + buffer.cursorY
    const first = this.queue[0]
    if (first && (first.row !== row || first.col !== buffer.cursorX)) {
      this.reset()
      return
    }
    const col = this.queue.length ? this.queue[this.queue.length - 1].col + 1 : buffer.cursorX
    const cell = buffer.getLine(row)?.getCell(col)
    if (col >= term.cols - 1 || !cell || cell.getWidth() !== 1 || !['', ' '].includes(cell.getChars())) {
      this.reset()
      return
    }
    this.queue.push({ row, col, char: data, at: now, display: this.canDisplay(now, rttMs, mode) })
  }

  /** Called after server bytes have been parsed, never when they merely arrive. */
  parsed(term: EchoTerminal, state: EchoState, now: number, rttMs: number | null): void {
    this.expire(now, rttMs)
    if (!allowed(term, state) || !this.queue.length) {
      // Unsolicited output may be a new prompt. Relearn echo there instead of
      // carrying the previous command's confidence into a non-echoing reader.
      this.reset()
      return
    }
    const buffer = term.buffer.active
    // A status redraw can touch a later predicted cell and restore the cursor
    // to the first one. Waiting for that first echo must not hide the clash.
    for (const prediction of this.queue) {
      const cell = buffer.getLine(prediction.row)?.getCell(prediction.col)
      const chars = cell?.getChars()
      if (!cell || cell.getWidth() !== 1 || (chars !== '' && chars !== ' ' && chars !== prediction.char)) {
        this.reset()
        return
      }
    }
    let last: Prediction | undefined
    while (this.queue.length) {
      const next = this.queue[0]
      const cell = buffer.getLine(next.row)?.getCell(next.col)
      if (buffer.baseY + buffer.cursorY !== next.row || !cell || cell.getWidth() !== 1) {
        this.reset()
        return
      }
      const chars = cell.getChars()
      // Cursor progress matters for spaces: a blank cell alone is not proof
      // that a password reader echoed the space somebody just typed.
      if (chars === next.char && buffer.cursorX > next.col) {
        last = this.queue.shift()
        this.confirmedAt = now
      } else if ((chars === '' || chars === ' ') && buffer.cursorX === next.col) {
        return
      } else {
        this.reset()
        return
      }
    }
    if (last && buffer.cursorX !== last.col + 1) this.reset()
  }

  expire(now: number, rttMs: number | null): void {
    const due = this.deadline(rttMs)
    if (due !== null && now >= due) this.reset()
  }

  visible(now: number, rttMs: number | null, mode: LocalEchoMode): readonly Prediction[] {
    this.expire(now, rttMs)
    return this.canDisplay(now, rttMs, mode) ? this.queue.filter((prediction) => prediction.display) : []
  }

  /** No periodic work for an idle terminal, only a deadline for pending input. */
  deadline(rttMs: number | null): number | null {
    const first = this.queue[0]
    if (!first) return null
    const timeout = first.at + Math.max(1_500, 4 * (rttMs ?? 0))
    return this.confirmedAt !== null && this.queue.some((prediction) => prediction.display)
      ? Math.min(timeout, this.confirmedAt + CONFIDENCE_MS) : timeout
  }
}
