import type { DerivedCacheStore } from '@/lib/media/derived-cache'
import type { MediaByteStore } from '@/lib/media/media-byte-store'

/**
 * Storage ownership:
 *
 * Supabase holds auth, project identity, and the ProjectDocument. That document
 * is the shared project state. It never includes files, blobs, object URLs,
 * directory handles, absolute paths, or caches.
 *
 * The workspace is a folder the user picks on this device. It holds local
 * source media, a local project mirror, and rebuildable caches. A mediaSourceId
 * in the document is a shared reference. It does not mean this device has the
 * bytes. Another collaborator can open the same project with the media missing.
 *
 * Runtime state (File, Blob, object URL, media elements, decoded frames,
 * playback, UI) stays in memory.
 *
 * Future cloud media will fill a missing local source. Future collaboration
 * will sync operations, not media bytes or caches.
 */

export const WORKSPACE_VERSION = 1 as const

/** Identity stored inside the chosen folder. No path, handle, or credentials. */
export type WorkspaceFile = {
  version: typeof WORKSPACE_VERSION
  id: string
  name: string
  createdAt: string
}

export type WorkspaceEntry = {
  name: string
  kind: 'file' | 'directory'
}

/**
 * One directory in a workspace. Browser code wraps a FileSystemDirectoryHandle.
 * Tests use an in-memory tree. React components never see either one.
 */
export interface WorkspaceDirectory {
  readonly name: string
  list(): Promise<WorkspaceEntry[]>
  readFile(name: string): Promise<Blob | null>
  writeFile(name: string, data: Blob): Promise<void>
  remove(name: string, options?: { recursive?: boolean }): Promise<void>
  openDirectory(
    name: string,
    options?: { create?: boolean },
  ): Promise<WorkspaceDirectory | null>
}

export type WorkspaceSnapshot = {
  status: 'unsupported' | 'none' | 'ready' | 'needs-permission'
  /** Folder name only, such as "Framebase". Never an absolute path. */
  folderName: string | null
  workspaceId: string | null
  error: string | null
}

export type WorkspaceMediaBinding = {
  media: MediaByteStore | null
  cache: DerivedCacheStore | null
}
