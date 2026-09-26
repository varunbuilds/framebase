import { getDerivedCacheStore } from './derived-cache'
import { deleteMedia } from './opfs-media-store'

/**
 * Removes source bytes, then derived caches. Cache cleanup cannot delete
 * source bytes because they live in a different directory. A cache cleanup
 * failure does not put the source back, and a source failure skips cache
 * cleanup so a still-present source keeps its caches.
 */
export async function deleteStoredMedia(mediaSourceId: string): Promise<void> {
  await deleteMedia(mediaSourceId)
  try {
    await getDerivedCacheStore().deleteMedia(mediaSourceId)
  } catch {
    // Orphan cache files can be rebuilt or ignored. They are not the source.
  }
}
