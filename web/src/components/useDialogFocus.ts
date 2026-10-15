import { useEffect, useRef, useState, type RefObject } from 'react'

import { escapeClosesThis, nextTabIndex, shouldRestoreFocus } from './dialogFocus'

/**
 * Open dialogs, oldest first. Settings can raise a confirmation, so the
 * question "which one does Escape close" has an answer only if somebody keeps
 * the order; a DOM query for "is another modal up" cannot tell above from below.
 */
const stack: object[] = []

const TABBABLE =
  'a[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]'

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.tabIndex < 0) return false
    if ((el as HTMLButtonElement).disabled) return false
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false
    // Not rendered: display:none, or inside something that is. Tab cannot land
    // there, so counting it would make the "last" element one nobody can reach
    // and the wrap would never fire.
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  })
}

/**
 * What a modal owes the keyboard: take it on open, keep Tab inside, close on
 * Escape, and give it back to whatever opened the dialog.
 *
 * None of the dialogs did any of it. Tab walked out of the settings into the
 * page behind it, and closing left the focus on `<body>`, so the next Tab
 * started from the top of the sidebar -- measured in all three engines.
 *
 * Initial focus is the caller's: a confirmation starts on Cancel and a picker
 * on its field. This only steps in when nothing inside the dialog has it.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: { escape?: boolean } = {},
) {
  const escape = opts.escape !== false
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  // Read while rendering: an autoFocus inside the dialog has moved the focus
  // by the time any effect runs, and the opener would be lost.
  const [opener] = useState<Element | null>(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  )

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const me = {}
    stack.push(me)

    if (!root.contains(document.activeElement)) {
      const first = tabbables(root)[0]
      if (first) first.focus()
      else {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
        root.focus()
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return
      if (e.key === 'Tab' && !e.defaultPrevented) {
        const list = tabbables(root)
        if (list.length === 0) {
          e.preventDefault()
          return
        }
        const at = list.findIndex((el) => el === document.activeElement)
        const to = nextTabIndex(list.length, root.contains(document.activeElement) ? at : -1, e.shiftKey)
        if (to !== null) {
          e.preventDefault()
          list[to].focus()
        }
        return
      }
      if (escape && escapeClosesThis(stack, me, e)) {
        e.preventDefault()
        // And no further. This listener is on the document; a dialog that
        // keeps its own Escape on the window -- the archived list, the launch
        // picker -- hears the same press a moment later, and by then the
        // question that answered it has already gone from the page, so the
        // "is a confirmation up?" guard those dialogs carry finds nothing. One
        // Escape on "delete this?" closed the archived list as well.
        e.stopPropagation()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKey)

    const from = opener
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = stack.indexOf(me)
      if (at >= 0) stack.splice(at, 1)
      const a = document.activeElement
      if (
        from instanceof HTMLElement &&
        shouldRestoreFocus(
          a === null ? null : { isBody: a === document.body, insideDialog: root.contains(a) },
          from.isConnected,
        )
      ) {
        from.focus()
      }
    }
  }, [ref, escape, opener])
}
