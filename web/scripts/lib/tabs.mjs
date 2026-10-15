/**
 * Tabs that are narrower than their own label, or that a strip hides without
 * a way to reach.
 *
 * `.vp-segmented > .vp-tab` used to be `flex: 1 1 0; min-width: 0`: a strip
 * with more in it than its row made every tab narrower than its content, so
 * "Alerts" ran into the next tab's icon and, at 320px, the strip clipped with
 * nothing to say there was more. Three questions, asked of every visible
 * `.vp-tab`:
 *
 *   1. does its own content fit (scrollWidth <= clientWidth)?
 *   2. does anything inside it stick out past its edge, or does it overlap the
 *      next tab?
 *   3. if the strip it sits in is wider than the strip's box, can it scroll,
 *      and does scrolling bring this tab fully into view?
 */
export async function findClippedTabs(target) {
  return target.evaluate(() => {
    const out = []
    let examined = 0
    const name = (el) => (el.getAttribute('data-testid') || el.textContent || '').trim().slice(0, 24)
    const scroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll') return p
      }
      return null
    }
    const tabs = [...document.querySelectorAll('.vp-tab')].filter((el) => el.getClientRects().length > 0)
    for (const el of tabs) {
      examined++
      if (el.scrollWidth > el.clientWidth + 1) {
        out.push(`${name(el)}: content ${el.scrollWidth}px in a ${el.clientWidth}px tab`)
      }
      const box = el.getBoundingClientRect()
      for (const child of el.querySelectorAll('*')) {
        const c = child.getBoundingClientRect()
        if (c.width > 0 && (c.right > box.right + 1 || c.left < box.left - 1) && getComputedStyle(el).display !== 'none') {
          out.push(`${name(el)}: ${child.tagName.toLowerCase()} sticks out of its tab by ${Math.round(Math.max(c.right - box.right, box.left - c.left))}px`)
          break
        }
      }
    }
    // Neighbours in the same row must not overlap.
    for (const strip of new Set(tabs.map((t) => t.parentElement))) {
      const row = tabs.filter((t) => t.parentElement === strip)
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i].getBoundingClientRect()
        const b = row[i + 1].getBoundingClientRect()
        if (a.top < b.bottom && b.top < a.bottom && a.right > b.left + 1 && b.right > a.left) {
          out.push(`${name(row[i])} overlaps ${name(row[i + 1])}`)
        }
      }
    }
    // Reachable: scrolled into view, each tab is inside its scroller's box.
    for (const el of tabs) {
      const s = scroller(el)
      if (!s) continue
      el.scrollIntoView({ inline: 'nearest', block: 'nearest' })
      const r = el.getBoundingClientRect()
      const v = s.getBoundingClientRect()
      if (r.left < v.left - 1 || r.right > v.right + 1) {
        out.push(`${name(el)}: cannot be scrolled into view (${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(v.left)}..${Math.round(v.right)})`)
      }
    }
    return { examined, out }
  })
}
