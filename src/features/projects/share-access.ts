import { isProjectId } from '@/features/projects/document'

const SHARE_TOKEN = /^[0-9a-f]{64}$/

/** The random token from a share URL. Not a project id. */
export function isShareToken(value: string): boolean {
  return SHARE_TOKEN.test(value)
}

export function shareJoinPath(token: string): string {
  if (!isShareToken(token)) throw new Error('Invalid share token')
  return `/join/${token}`
}

/**
 * Future Liveblocks room. An auth endpoint must confirm project membership
 * before issuing access. The room does not carry source media or caches.
 */
export function projectCollaborationRoomId(projectId: string): string {
  if (!isProjectId(projectId)) throw new Error('Invalid project id')
  return projectId
}

export function canDeleteProject(role: 'owner' | 'editor'): boolean {
  return role === 'owner'
}

export function canManageShareLink(role: 'owner' | 'editor'): boolean {
  return role === 'owner'
}

/** Redeeming a link never downgrades an owner or duplicates a membership role. */
export function roleAfterShareRedeem(
  existing: 'owner' | 'editor' | null,
): 'owner' | 'editor' {
  if (existing === 'owner') return 'owner'
  return 'editor'
}

export function projectAccessRole(
  ownerId: string,
  userId: string | null | undefined,
): 'owner' | 'editor' | null {
  if (!userId) return null
  return ownerId === userId ? 'owner' : 'editor'
}

const rememberedKey = (projectId: string) => `framebase.share-token.${projectId}`

type TokenMemory = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Remembers the raw token for the owner who just created it. Not the project document. */
export function rememberShareToken(
  storage: TokenMemory,
  projectId: string,
  token: string,
): void {
  if (!isProjectId(projectId) || !isShareToken(token)) {
    throw new Error('Invalid share token')
  }
  storage.setItem(rememberedKey(projectId), token)
}

export function readShareToken(storage: TokenMemory, projectId: string): string | null {
  const token = storage.getItem(rememberedKey(projectId))
  return token && isShareToken(token) ? token : null
}

export function forgetShareToken(storage: TokenMemory, projectId: string): void {
  storage.removeItem(rememberedKey(projectId))
}
