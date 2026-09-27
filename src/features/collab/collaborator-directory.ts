import { colorForUserId } from './presence-schema'

/**
 * Names published by the Liveblocks auth endpoint from the Supabase user.
 * Avatar and Cursor resolve through `resolveUsers`, which does not receive
 * room presence, so the room caches those names here and invalidates them.
 */
const namesByUserId = new Map<string, string>()

export function rememberCollaborators(
  users: ReadonlyArray<{ id: string; name: string }>,
): boolean {
  let changed = false
  for (const user of users) {
    const name = user.name.trim()
    if (!user.id || !name) continue
    if (namesByUserId.get(user.id) === name) continue
    namesByUserId.set(user.id, name)
    changed = true
  }
  return changed
}

export function resolveFramebaseUsers({ userIds }: { userIds: string[] }) {
  return userIds.map((userId) => ({
    name: namesByUserId.get(userId) ?? 'Collaborator',
    color: colorForUserId(userId),
  }))
}

/** Test-only reset. The production map lives for the page session. */
export function clearCollaboratorDirectory(): void {
  namesByUserId.clear()
}
