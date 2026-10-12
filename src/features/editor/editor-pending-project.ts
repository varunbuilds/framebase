import { projectAccessRole } from '@/features/projects/share-access'
import type { CanvasAspectRatio } from '@/types/timeline'

/** The Supabase project row. Absent while the editor route loader is still pending. */
export type PendingEditorProject = {
  id: string
  ownerId: string
  document: { canvas: { aspectRatio: CanvasAspectRatio } }
} | null | undefined

/**
 * Share stays hidden until the project row exists. Ownership is still decided
 * from that row; a missing row is the pending loader, not a failed check.
 */
export function shareControlForProject(
  project: PendingEditorProject,
  userId: string | null | undefined,
): { canShare: boolean; projectId: string | null } {
  if (!project?.id || !project.ownerId) return { canShare: false, projectId: null }
  return {
    canShare: projectAccessRole(project.ownerId, userId) === 'owner',
    projectId: project.id,
  }
}

/** Preview frame ratio before the collaborative document is ready. */
export function previewAspectForSession(args: {
  structureReady: boolean
  documentAspect: CanvasAspectRatio | undefined
  loaded: PendingEditorProject
}): CanvasAspectRatio {
  if (args.structureReady && args.documentAspect) return args.documentAspect
  return args.loaded?.document?.canvas?.aspectRatio ?? '16:9'
}
