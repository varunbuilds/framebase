import { getMedia } from '@/lib/media/opfs-media-store'
import { getObjectUrl } from '@/lib/media/object-urls'

/**
 * Bytes already available to the editor: workspace or OPFS first, then the
 * runtime object URL used for playback. Does not re-import or copy the file.
 */
export async function loadExportMedia(mediaSourceId: string): Promise<Blob | null> {
  try {
    const stored = await getMedia(mediaSourceId)
    if (stored?.blob) return stored.blob
  } catch {
    // Fall through to the runtime URL. A store error is still "unavailable"
    // only when that URL is missing too.
  }

  const url = getObjectUrl(mediaSourceId)
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.blob()
  } catch {
    return null
  }
}
