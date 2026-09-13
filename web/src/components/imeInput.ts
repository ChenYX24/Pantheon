/**
 * macOS IME punctuation, and the private xterm flag that drops it.
 *
 * xterm 6.0.0 accepts a browser `insertText` input event only when
 * `!ev.composed || !this._keyDownSeen` (CoreBrowserTerminal._inputEvent). A
 * browser-dispatched input event always has `composed === true`, so the real
 * gate is `_keyDownSeen` — a flag set at the top of every keydown and cleared
 * in keyup, which assumes `input` always arrives *after* the keydown of the
 * same keystroke.
 *
 * That assumption does not hold for full-width punctuation typed with the
 * macOS Chinese IME, and the difference is invisible in every other way. No
 * `composition*` events fire at all; the event order is `beforeinput` →
 * `input` → `keydown` (keyCode 229). `！` needs Shift, so Shift's keydown set
 * `_keyDownSeen` and its keyup has not happened yet, and the input event is
 * discarded. The next character's keyup clears the flag, which is why only
 * the first one is lost: 「第一个 ！ 要按两次」, and `？` and `＋` the same.
 * ASCII is unaffected because xterm's keypress path already handled it and
 * `_keyPressHandled` rejects the input event regardless of the flag.
 *
 * The fix is a capture-phase `beforeinput` listener on the element containing
 * xterm's textarea. Capture on the ancestor runs before the textarea's own
 * listeners, so clearing `_keyDownSeen` there lands before xterm's input
 * handler reads it. A listener on `input` itself would be too late.
 *
 * Two things keep it from becoming a worse bug than it fixes:
 *
 *   - It is scoped to `insertText` outside any composition. Real composition
 *     commits (`insertCompositionText`, or `isComposing`) are left alone,
 *     because the CompositionHelper sends those from its own deferred
 *     callback; releasing the flag there would let the input event send the
 *     text a second time. That duplication is a known xterm failure mode, and
 *     this must not recreate it from the other direction.
 *   - Every private field is optional and checked. If xterm is upgraded and
 *     renames one, this goes quiet and the terminal behaves as it does today,
 *     rather than throwing inside an input event. `imeInput.test.ts` reads the
 *     installed bundle and fails if the fields move, so the next upgrade is
 *     looked at rather than silently losing the fix.
 */

/** The xterm internals this reaches into. See the file comment for why. */
interface XtermCore {
  _keyDownSeen?: boolean
  _compositionHelper?: {
    _isComposing?: boolean
    _isSendingComposition?: boolean
  }
}

/** The parts of an InputEvent this reads, so tests need no DOM. */
export interface TextInputLike {
  inputType: string
  data: string | null
  isComposing: boolean
}

/**
 * Clear xterm's `_keyDownSeen` for an IME commit the flag would otherwise
 * drop. Returns whether it did.
 *
 * Exported for the test: the listener below is three lines and the decision is
 * the part worth checking.
 */
export function releaseImeCommit(terminal: unknown, ev: TextInputLike): boolean {
  if (ev.inputType !== 'insertText' || !ev.data || ev.isComposing) return false

  const core = (terminal as { _core?: XtermCore } | null)?._core
  if (!core || core._keyDownSeen !== true) return false

  // Unknown composition state is treated as composing. The cost of being
  // wrong in this direction is the old behaviour; the cost in the other is a
  // character sent twice.
  const helper = core._compositionHelper
  if (
    !helper ||
    typeof helper._isComposing !== 'boolean' ||
    typeof helper._isSendingComposition !== 'boolean' ||
    helper._isComposing ||
    helper._isSendingComposition
  ) {
    return false
  }

  core._keyDownSeen = false
  return true
}

/**
 * Attach the fix to the element containing xterm's textarea, and return the
 * detach. Called from Terminal.tsx's terminal-lifetime effect.
 */
export function attachImeCommitFix(host: EventTarget, terminal: unknown): () => void {
  const onBeforeInput = (ev: Event) => {
    releaseImeCommit(terminal, ev as unknown as TextInputLike)
  }
  // Capture, so this runs before the textarea's own listeners. See above.
  host.addEventListener('beforeinput', onBeforeInput, true)
  return () => host.removeEventListener('beforeinput', onBeforeInput, true)
}
