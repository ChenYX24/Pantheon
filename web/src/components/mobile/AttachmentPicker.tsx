import { useRef } from 'react'
import { ImagePlus, Paperclip } from 'lucide-react'
import { t, useLang } from '../../i18n'

/** A dedicated photo chooser alongside the existing general file chooser.
 * Leave capture unset so choosing an existing screenshot remains possible.
 * Input activation stays synchronous in the tap, including on mobile Safari. */
export function AttachmentPicker({
  prefix,
  onFiles,
  className,
}: {
  prefix: 'compose' | 'touch'
  onFiles: (files: File[]) => void
  className: string
}) {
  useLang()
  const photos = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const selected = (input: HTMLInputElement) => {
    const chosen = Array.from(input.files ?? [])
    input.value = ''
    if (chosen.length > 0) onFiles(chosen)
  }
  return <>
    <input ref={photos} type="file" multiple accept="image/*" className="hidden"
      data-testid={`${prefix}-photo-file`} onChange={(e) => selected(e.currentTarget)} />
    <input ref={files} type="file" multiple className="hidden"
      data-testid={`${prefix}-file`} onChange={(e) => selected(e.currentTarget)} />
    <button type="button" onClick={() => photos.current?.click()}
      data-testid={`${prefix}-attach`} title={t('compose.photos')} aria-label={t('compose.photos')}
      className={className}>
      <ImagePlus size={15} />
    </button>
    <button type="button" onClick={() => files.current?.click()}
      data-testid={`${prefix}-attach-file`} title={t('compose.files')} aria-label={t('compose.files')}
      className={className}>
      <Paperclip size={15} />
    </button>
  </>
}
