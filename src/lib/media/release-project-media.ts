import type { ProjectDocument } from '@/types/timeline'
import { deleteStoredMedia } from './delete-stored-media'

/**
 * Deletes OPFS source bytes and derived caches for this project's sources.
 * Import ids are unique, so another project's media is not referenced here.
 */
export async function releaseProjectMedia(document: ProjectDocument): Promise<void> {
  const keys = document.mediaSources.flatMap((source) =>
    source.locator.kind === 'opfs' ? [source.locator.key] : [],
  )
  await Promise.all(keys.map((key) => deleteStoredMedia(key).catch(() => undefined)))
}
