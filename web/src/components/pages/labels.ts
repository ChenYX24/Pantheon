import { t, type Key } from '../../i18n'

/**
 * The words the built-in page templates ship with, in the reader's language.
 *
 * A manifest holds one `label` and no translations (docs/page-backend.md), so
 * the editor showed "Title", "Accent" and "Waiting turns urgent at" in the
 * middle of a Chinese form. The templates are the panel's own, so the panel
 * owns the translation: an exact match on the English text, and anything else
 * -- a page the owner wrote -- is shown as written.
 */
const KNOWN: Record<string, Key> = {
  Title: 'pl.title',
  Accent: 'pl.accent',
  'Waiting turns urgent at': 'pl.warnAt',
  Announcement: 'pl.announcement',
  Guestbook: 'pl.guestbook',
  Message: 'pl.message',
  Name: 'pl.name',
  'Notes for whoever runs this screen': 'pl.notes',
  'Sign the guestbook': 'pl.signGuestbook',
  'Split by': 'pl.splitBy',
  Vote: 'pl.vote',
  Votes: 'pl.votes',
  'What the vote is for': 'pl.voteFor',
}

/** English text of every label a built-in template carries. */
export const KNOWN_LABELS = Object.keys(KNOWN)

export function pageLabel(label: string): string {
  const key = KNOWN[label]
  return key ? t(key) : label
}
