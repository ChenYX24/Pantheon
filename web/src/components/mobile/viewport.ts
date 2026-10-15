import { useEffect, useState } from 'react'

/**
 * How much of the key bar a phone has room for.
 *
 * The compose box and the two rows of keys took 105-153px, fixed, whatever
 * the screen. A phone in landscape, or any phone with its keyboard up, has a
 * few hundred pixels in all: measured on an iPhone SE, an iPhone 13 and a 320
 * Android in landscape with the keyboard's share taken away, the terminal --
 * the thing being answered -- came out 0px tall. So the keys give way before
 * the terminal does: the second row goes first, then the whole bar.
 *
 * `visible` is the visual viewport's height, the part not under the keyboard;
 * `layout` is the window's. Numbers in, a decision out, so it can be tested.
 */
export type KeyBarFit = 'full' | 'one' | 'none'

/** Less than this is visible and the bar goes entirely; compose stays. */
export const KEYS_NONE_BELOW = 320
/** Less than this and the second row goes. A portrait phone is 640 and up. */
export const KEYS_ONE_BELOW = 500
/** A layout this much taller than what is visible means a keyboard is up. */
export const KEYBOARD_AT_LEAST = 120

export function keyBarFit(visible: number, layout: number): KeyBarFit {
  if (visible < KEYS_NONE_BELOW) return 'none'
  if (visible < KEYS_ONE_BELOW || layout - visible >= KEYBOARD_AT_LEAST) return 'one'
  return 'full'
}

/**
 * Sizes the app to what is actually visible, and says how much of the key bar
 * fits.
 *
 * iOS does not shrink the layout when its keyboard opens; it slides the visual
 * viewport over a layout that stays full height, so a `height: 100%` root kept
 * the compose box and the keys underneath the keyboard. `--vp-app-h` follows
 * the visual viewport instead, and `#root` takes it. Chrome on Android is told
 * to resize the content by `interactive-widget` in index.html; this agrees
 * with it there and does the work on iOS.
 */
export function useViewportFit(enabled: boolean): KeyBarFit {
  const [fit, setFit] = useState<KeyBarFit>('full')
  useEffect(() => {
    if (!enabled) return
    const vv = window.visualViewport
    const root = document.documentElement
    const apply = () => {
      // A pinch-zoom also shrinks the visual viewport, and sizing the app to
      // it would shrink the app under the person zooming into it. A keyboard
      // leaves the scale at 1.
      if (vv && vv.scale > 1.01) return
      const visible = vv ? vv.height : window.innerHeight
      root.style.setProperty('--vp-app-h', `${Math.round(visible)}px`)
      // iOS scrolls the page to keep a focused field in view, and with the
      // root already sized to what is visible that scroll only moves the
      // header off the top.
      if (vv && vv.offsetTop > 0) window.scrollTo(0, 0)
      setFit(keyBarFit(visible, window.innerHeight))
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
      root.style.removeProperty('--vp-app-h')
      setFit('full')
    }
  }, [enabled])
  return fit
}
