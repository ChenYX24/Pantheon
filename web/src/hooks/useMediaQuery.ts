import { useCallback, useSyncExternalStore } from 'react'

/**
 * Tracks a media query.
 *
 * Layout decisions in this panel are made on width, never on user agent. A
 * browser window dragged narrow on a desktop and a phone in portrait need the
 * same layout; asking "is this a phone" gets that wrong in both directions.
 *
 * useSyncExternalStore rather than useState plus an effect: matchMedia is an
 * external store, and the effect version reads it one render after mount, so
 * the first paint is against the wrong breakpoint.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * When the panel uses its phone layout: overlay sidebar, compose box, key bar.
 *
 * Width, or a short viewport with a coarse pointer.
 *
 * Width alone was the whole rule, and a phone in landscape is 844 by 390 —
 * wide by that measure, so it got the desktop layout: a 260px sidebar, the
 * right panel, the bottom terminal strip, and a **six line** terminal. No
 * compose box and no key bar either, so rotating the phone lost the ability to
 * type Chinese, send Ctrl-C or press an arrow key. Turning a phone sideways is
 * something people do to see *more* of a terminal.
 *
 * The second clause is deliberately not "is it short": a desktop window dragged
 * short is still a desktop, with a keyboard and a mouse, and it keeps the wide
 * layout. Short *and* driven by a finger is a phone held sideways, which is the
 * only thing this is trying to catch.
 */
export const NARROW_QUERY = '(max-width: 767px), (max-height: 500px) and (pointer: coarse)'

/**
 * The tablet tier: wide enough not to be a phone, too narrow for three
 * columns.
 *
 * From 768 up there used to be one layout, the desktop's. On an iPad mini or
 * Air in portrait, and in Slide Over, a 256px sidebar and a 360px side panel
 * left the terminal about 215px -- narrower than on the phone -- and cut off
 * the header's trailing controls. Here the side panel is a sheet over the
 * terminal, opened from the same header toggle, rather than a third column.
 * 1100 because below it a sidebar, a side panel at its minimum and an
 * 80-column terminal no longer fit side by side.
 */
export const COMPACT_QUERY = '(min-width: 768px) and (max-width: 1099px)'
