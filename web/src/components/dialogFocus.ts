/**
 * Where Tab goes next inside a dialog, as a function over the list.
 *
 * `index` is the position of the focused element among the dialog's tabbable
 * elements, or -1 when the focus is somewhere else entirely (the body, after a
 * click on dead space). Returns the index to focus, or null when the browser's
 * own step is already inside the list and should be left alone -- taking over
 * every Tab would also take over the order the page was written in.
 */
export function nextTabIndex(count: number, index: number, shift: boolean): number | null {
  if (count <= 0) return null
  if (index < 0) return shift ? count - 1 : 0
  if (!shift && index === count - 1) return 0
  if (shift && index === 0) return count - 1
  return null
}

/** Focus is handed back only if nobody has taken it somewhere on purpose. */
export function shouldRestoreFocus(
  active: { isBody: boolean; insideDialog: boolean } | null,
  openerConnected: boolean,
): boolean {
  if (!openerConnected) return false
  // No active element, the body, or something inside the dialog that is going
  // away: the focus is lost, not placed. Anything else is a click the person
  // made after asking to close, and it wins.
  return active === null || active.isBody || active.insideDialog
}

/** Escape closes the dialog on top, and only if nothing underneath it has used the key. */
export function escapeClosesThis(
  stack: readonly unknown[],
  me: unknown,
  e: { key: string; defaultPrevented: boolean; isComposing?: boolean; keyCode?: number },
): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false
  // Escape cancels a composition in an input method; it is not a request to close.
  if (e.isComposing || e.keyCode === 229) return false
  return stack.length > 0 && stack[stack.length - 1] === me
}
