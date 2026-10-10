import type { ProjectDocument } from '@/types/timeline'

/**
 * Ephemeral room presence. Liveblocks drops this when a user leaves.
 * It is never written into ProjectDocument, Storage, or Supabase.
 *
 * `cursor` is an absolute timeline position: time in milliseconds and
 * content-space Y. It is not a fraction of anyone's visible viewport.
 */
export type EditorActiveArea = 'timeline' | 'media' | 'preview' | 'inspector'

export type EditorCursor = {
  timeMs: number
  contentY: number
  trackId: string | null
}

export type EditorPresence = {
  cursor: EditorCursor | null
  selectedClipId: string | null
  activeArea: EditorActiveArea | null
}

export const EMPTY_EDITOR_PRESENCE: EditorPresence = {
  cursor: null,
  selectedClipId: null,
  activeArea: null,
}

const COLLABORATOR_COLORS = [
  '#3e7ecc',
  '#3dbe8c',
  '#e07a6a',
  '#e2b15a',
  '#a98adf',
  '#e08a4f',
  '#4eb8c9',
  '#d46b9a',
] as const

/** Stable per Supabase user, so every client paints the same person the same color. */
export function colorForUserId(userId: string): string {
  let hash = 0
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0
  }
  return COLLABORATOR_COLORS[hash % COLLABORATOR_COLORS.length] ?? COLLABORATOR_COLORS[0]
}

export function setSelectedClip(
  presence: EditorPresence,
  selectedClipId: string | null,
): EditorPresence {
  if (presence.selectedClipId === selectedClipId) return presence
  return { ...presence, selectedClipId }
}

export function clearSelectedClip(presence: EditorPresence): EditorPresence {
  return setSelectedClip(presence, null)
}

export function setCursor(
  presence: EditorPresence,
  cursor: EditorCursor | null,
): EditorPresence {
  if (
    presence.cursor?.timeMs === cursor?.timeMs &&
    presence.cursor?.contentY === cursor?.contentY &&
    presence.cursor?.trackId === cursor?.trackId &&
    (presence.cursor == null) === (cursor == null)
  ) {
    return presence
  }
  return { ...presence, cursor }
}

export function setActiveArea(
  presence: EditorPresence,
  activeArea: EditorActiveArea | null,
): EditorPresence {
  if (presence.activeArea === activeArea) return presence
  return { ...presence, activeArea }
}

export type CollaboratorSelection = {
  connectionId: number
  userId: string
  name: string
  color: string
  selectedClipId: string
}

export type PresenceSelection = {
  connectionId: number
  userId: string
  name: string
  selectedClipId: string | null
}

/** Others in the room whose presence currently selects this clip. Self is not included. */
export function collaboratorsOnClip(
  others: readonly PresenceSelection[],
  clipId: string,
): CollaboratorSelection[] {
  const marks: CollaboratorSelection[] = []
  for (const other of others) {
    if (other.selectedClipId !== clipId) continue
    const userId = other.userId || String(other.connectionId)
    marks.push({
      connectionId: other.connectionId,
      userId,
      name: other.name.trim() || 'Collaborator',
      color: colorForUserId(userId),
      selectedClipId: clipId,
    })
  }
  return marks
}

/** Presence edits return a new presence value and leave the document object untouched. */
export function presenceLeavesDocument<T extends ProjectDocument>(
  document: T,
  next: EditorPresence,
): { document: T; presence: EditorPresence } {
  return { document, presence: next }
}
