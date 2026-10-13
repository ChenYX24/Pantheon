/**
 * Whether a keydown is an Enter that means "submit".
 *
 * With an input method, Enter is how a candidate is chosen: Chromium, Firefox
 * and Safari report that keypress as key "Enter" with `isComposing` set, and
 * the transcription and dictation keyboards report keyCode 229 without it. A
 * handler that reads `key === 'Enter'` alone commits whatever is half-typed --
 * measured in the audit on the sidebar's rename, which saved a name with a
 * pinyin syllable in it, and on the API token form, which minted a token
 * named the same way. Seven places did that and three did not, because each
 * had been written separately.
 *
 * Takes either a React event or a native one.
 */
export function isEnter(e: {
  key: string
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
  isComposing?: boolean
  keyCode?: number
}): boolean {
  if (e.key !== 'Enter') return false
  const n = e.nativeEvent ?? e
  return !(n.isComposing || n.keyCode === 229)
}
