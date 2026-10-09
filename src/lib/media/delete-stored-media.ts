import { getDerivedCacheStore } from './derived-cache'
import { deleteMedia } from './opfs-media-store'

/**
 * Removes source bytes and derived caches. Workspace caches live inside the
 * media directory, so deleting that directory removes them. The cache call
 * still clears a legacy OPFS cache when the workspace copy is already gone.
 */
export async function deleteStoredMedia(mediaSourceId: string): Promise<void> {
  await deleteMedia(mediaSourceId)
  try {
    await getDerivedCacheStore().deleteMedia(mediaSourceId)
  } catch {
    // Orphan cache files can be rebuilt or ignored. They are not the source.
  }
}
