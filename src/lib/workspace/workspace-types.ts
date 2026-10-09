import type { DerivedCacheStore } from '@/lib/media/derived-cache'
import type { MediaByteStore } from '@/lib/media/media-byte-store'

/**
 * Storage ownership:
 *
 * Liveblocks Storage is the authoritative collaborative ProjectDocument.
 * Supabase holds auth, project identity, membership, and cloud media objects.
 * The document never includes files, blobs, object URLs, directory handles,
 * absolute paths, or caches.
 *
 * IndexedDB on this device remembers directory handles for workspaces the
 * user has selected. The current handle is stored separately from that
 * recent list. IndexedDB does not hold media bytes, the project document,
 * caches, credentials, or a filesystem path.
 *
 * The workspace folder holds local source media, a local project mirror,
 * thumbnails, and rebuildable caches. project.json mirrors Liveblocks. It
 * does not override it. A mediaSourceId in the document is a shared
 * reference. It does not mean this device has the bytes.
 *
 * OPFS is only a legacy/runtime fallback. Persistent user media stays in the
 * user-selected workspace.
 *
 * Runtime state (File, Blob, object URL, media elements, decoded frames,
 * playback, UI) stays in memory.
 */

export const WORKSPACE_SCHEMA_VERSION = 1 as const

/**
 * Identity of the chosen folder. `name` is the directory name in memory.
 * The marker file stores schemaVersion, workspaceId, and createdAt only.
 */
export type WorkspaceFile = {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION
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
  status: 'unsupported' | 'none' | 'restoring' | 'ready' | 'needs-permission'
  /** Folder name only, such as "Framebase". Never an absolute path. */
  folderName: string | null
  workspaceId: string | null
  error: string | null
}

export type WorkspaceMediaBinding = {
  media: MediaByteStore | null
  cache: DerivedCacheStore | null
}
