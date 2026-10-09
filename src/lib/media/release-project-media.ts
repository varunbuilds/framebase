import type { ProjectDocument } from '@/types/timeline'
import { countProjectsWithMedia } from '@/features/projects/repository'
import {
  isWorkspaceReady,
  localMediaIdsNotMirroredElsewhere,
  removeWorkspaceProject,
} from '@/lib/workspace/workspace-manager'
import { boundWorkspaceMedia } from '@/lib/workspace/store-binding'
import { deleteStoredMedia } from './delete-stored-media'

/**
 * Removes the local project mirror. Local bytes are deleted only when no other
 * local project mirror lists the id and Supabase reports no remaining project
 * that contains it. A failed cloud count keeps the local file.
 */
export async function releaseProjectMedia(
  document: ProjectDocument,
  countProjects: (mediaSourceId: string) => Promise<number> = countProjectsWithMedia,
): Promise<void> {
  const keys = document.mediaSources.flatMap((source) =>
    source.locator.kind === 'opfs' || source.locator.kind === 'local'
      ? [source.locator.key]
      : [],
  )
  const candidates = isWorkspaceReady()
    ? await localMediaIdsNotMirroredElsewhere(document.id, keys)
    : keys
  await removeWorkspaceProject(document.id).catch(() => undefined)
  for (const key of candidates) {
    try {
      if ((await countProjects(key)) > 0) continue
    } catch {
      continue
    }
    await deleteStoredMedia(key).catch(() => undefined)
    await boundWorkspaceMedia()?.delete(key).catch(() => undefined)
  }
}
