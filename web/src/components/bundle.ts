/**
 * The entry script this page booted from, by name: index-<hash>.js.
 *
 * Read from the document rather than from import.meta.url, because the module
 * holding that would be whichever chunk the bundler put it in, and the script
 * tag index.html carried is the build this page actually is. Empty under the
 * Vite dev server, which serves /src/main.tsx and never goes stale this way.
 */
export function ownBundle(doc?: Pick<Document, 'querySelectorAll'>): string {
  // No document is a test or a worker, neither of which is a stale page.
  doc ??= typeof document === 'undefined' ? undefined : document
  if (!doc) return ''
  for (const el of Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))) {
    const m = /\/assets\/(index-[A-Za-z0-9_-]+\.js)(?:[?#].*)?$/.exec(el.getAttribute('src') ?? '')
    if (m) return m[1]
  }
  return ''
}

/** Whether the server is serving a different interface from this page's. */
export function isOutdated(served: string, own: string): boolean {
  return served !== '' && own !== '' && served !== own
}
