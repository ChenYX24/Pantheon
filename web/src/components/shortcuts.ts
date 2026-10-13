/**
 * The panel's own keys, which work from inside a terminal.
 *
 * There were none: a keyboard could not switch sessions at all, and Tab
 * inside a terminal is the terminal's (completion, an agent's own menus), so
 * once there it could not leave either. In the hands-on run Alt+arrows and
 * Ctrl+K were tried and arrived in the agent as `^[[1;3B^K` -- which is right,
 * because Alt+arrow is a word jump in a shell and Ctrl+K kills to the end of
 * the line; neither can be taken from a terminal.
 *
 * Ctrl+Shift with an arrow is what is left: shells and the agents this panel
 * runs do not bind it, and a browser does not either outside a text field.
 * Up and down move between sessions in the order the sidebar shows them;
 * left leaves the terminal for the session list.
 */
export type PanelShortcut = 'prev' | 'next' | 'leave'

/** Enough of a DOM element to say whether it edits text. */
export interface KeyTarget {
  tagName?: string
  type?: string
  isContentEditable?: boolean
  classList?: { contains(name: string): boolean }
}

const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'])

/**
 * Whether a key pressed here belongs to a text field.
 *
 * Ctrl+Shift+Left and Right select by word in every input and textarea, and
 * Ctrl+Shift+Up and Down by paragraph in some; a window listener that took
 * them moved the person to the sidebar in the middle of selecting a word in
 * the notes, a settings field or the phone's compose box. Except xterm's own
 * helper textarea: it is where a terminal's keyboard focus sits, and the
 * panel's keys exist above all for there.
 */
function editsText(t: KeyTarget | null | undefined): boolean {
  if (!t) return false
  if (t.classList?.contains('xterm-helper-textarea')) return false
  if (t.isContentEditable) return true
  const tag = (t.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') return !NOT_TEXT.has((t.type ?? 'text').toLowerCase())
  return false
}

export function panelShortcut(e: {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  type?: string
  target?: unknown
}): PanelShortcut | null {
  if (e.type !== undefined && e.type !== 'keydown') return null
  if (editsText(e.target as KeyTarget | null | undefined)) return null
  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return null
  switch (e.key) {
    case 'ArrowUp':
      return 'prev'
    case 'ArrowDown':
      return 'next'
    case 'ArrowLeft':
      return 'leave'
  }
  return null
}

/** The session after or before `current` in `order`, wrapping. */
export function neighbour(order: string[], current: string | null, dir: 'prev' | 'next'): string | null {
  if (order.length === 0) return null
  const i = current ? order.indexOf(current) : -1
  if (i < 0) return order[0]
  const step = dir === 'next' ? 1 : -1
  return order[(i + step + order.length) % order.length]
}
