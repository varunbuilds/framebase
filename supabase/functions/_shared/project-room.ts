/**
 * Framebase Liveblocks room identity and project authorization rules.
 *
 * This module is imported by the browser app and by the Supabase Edge Function
 * that issues Liveblocks tokens, so it must stay dependency free and runtime
 * agnostic (no Deno, no Vite, no Supabase imports).
 */

export const FRAMEBASE_ROOM_PREFIX = 'framebase:'

const PROJECT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Owner and editor are the two roles stored in public.project_members. */
export type ProjectRole = 'owner' | 'editor'

export function isProjectUuid(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_UUID.test(value)
}

/**
 * One room per Framebase project. There is no global room, no room per user,
 * and no room per timeline.
 */
export function projectRoomId(projectId: string): string {
  if (!isProjectUuid(projectId)) throw new Error('Invalid project id')
  return `${FRAMEBASE_ROOM_PREFIX}${projectId}`
}

/** null for a malformed room id, a foreign prefix, or a non-UUID project. */
export function projectIdFromRoomId(roomId: unknown): string | null {
  if (typeof roomId !== 'string') return null
  if (!roomId.startsWith(FRAMEBASE_ROOM_PREFIX)) return null
  const projectId = roomId.slice(FRAMEBASE_ROOM_PREFIX.length)
  return isProjectUuid(projectId) ? projectId : null
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === 'owner' || value === 'editor'
}

export type RoomAuthorizationRequest = {
  /** The room the browser asked for, exactly as received. */
  roomId: unknown
  /** The Supabase user id resolved from the caller's access token. */
  userId: unknown
  /** role from public.project_members for (project, user), or null. */
  membershipRole: unknown
}

export type RoomAuthorization =
  | { allowed: true; projectId: string; roomId: string; role: ProjectRole }
  | { allowed: false; status: 400 | 401 | 403; reason: string }

/**
 * Knowing a project id is never access. The caller must be signed in and hold
 * an owner or editor membership row for that exact project.
 */
export function authorizeProjectRoom(
  request: RoomAuthorizationRequest,
): RoomAuthorization {
  const projectId = projectIdFromRoomId(request.roomId)
  if (!projectId) {
    return { allowed: false, status: 400, reason: 'Invalid room id.' }
  }
  if (typeof request.userId !== 'string' || request.userId.length === 0) {
    return { allowed: false, status: 401, reason: 'Not signed in.' }
  }
  if (!isProjectRole(request.membershipRole)) {
    return { allowed: false, status: 403, reason: 'Not a member of this project.' }
  }
  return {
    allowed: true,
    projectId,
    roomId: projectRoomId(projectId),
    role: request.membershipRole,
  }
}
