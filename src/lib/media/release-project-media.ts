import type { ProjectDocument } from '@/types/timeline'
import { deleteMedia } from './opfs-media-store'

/** Deletes OPFS bytes for this project's sources. Ids are unique per import. */
export async function releaseProjectMedia(document: ProjectDocument): Promise<void> {
  const keys = document.mediaSources.flatMap((source) =>
    source.locator.kind === 'opfs' ? [source.locator.key] : [],
  )
  await Promise.all(keys.map((key) => deleteMedia(key).catch(() => undefined)))
}
