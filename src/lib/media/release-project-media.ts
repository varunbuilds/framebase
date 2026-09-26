import type { ProjectDocument } from '@/types/timeline'
import { removeWorkspaceProject } from '@/lib/workspace/workspace-manager'
import { deleteStoredMedia } from './delete-stored-media'

/**
 * Deletes this project's local mirror, source bytes, and derived caches.
 * Import ids are unique, so another project's media is not referenced here.
 * Unrelated files in the workspace folder are left alone.
 */
export async function releaseProjectMedia(document: ProjectDocument): Promise<void> {
  const keys = document.mediaSources.flatMap((source) =>
    source.locator.kind === 'opfs' || source.locator.kind === 'local'
      ? [source.locator.key]
      : [],
  )
  await Promise.all(keys.map((key) => deleteStoredMedia(key).catch(() => undefined)))
  await removeWorkspaceProject(document.id).catch(() => undefined)
}
