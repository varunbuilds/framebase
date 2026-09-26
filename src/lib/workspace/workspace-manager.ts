import type { ProjectDocument } from '@/types/timeline'
import { directoryFromHandle } from './file-system-directory'
import { bindWorkspaceStores } from './store-binding'
import { createWorkspaceCacheStore } from './workspace-cache-store'
import {
  createIndexedDbWorkspaceHandleStore,
  createMemoryWorkspaceHandleStore,
  type WorkspaceHandleStore,
} from './workspace-handle-store'
import {
  openExistingWorkspace,
  openOrCreateWorkspace,
  removeProjectDirectory,
  workspaceCacheDirectory,
  workspaceMediaDirectory,
  writeProjectMirror,
  WorkspaceFormatError,
} from './workspace-layout'
import { createWorkspaceMediaStore } from './workspace-media-store'
import { readWorkspacePointer, writeWorkspacePointer } from './workspace-pointer'
import {
  restoreStoredWorkspace,
  type StoredDirectoryHandle,
} from './workspace-restore'
import type { WorkspaceDirectory, WorkspaceFile, WorkspaceSnapshot } from './workspace-types'

const PICKER_ID = 'framebase-workspace'

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }) => Promise<FileSystemDirectoryHandle>
}

let root: WorkspaceDirectory | null = null
let info: WorkspaceFile | null = null
let handle: StoredDirectoryHandle | null = null
let snapshot: WorkspaceSnapshot = initialSnapshot()
const listeners = new Set<() => void>()
let handleStore: WorkspaceHandleStore<StoredDirectoryHandle> | null = null
let restorePromise: Promise<void> | null = null

function browserHandleStore(): WorkspaceHandleStore<StoredDirectoryHandle> {
  if (!handleStore) {
    handleStore =
      typeof indexedDB === 'undefined'
        ? createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
        : createIndexedDbWorkspaceHandleStore<StoredDirectoryHandle>(indexedDB)
  }
  return handleStore
}

/** Tests replace the IndexedDB handle store. Logout does not clear it. */
export function setWorkspaceHandleStore(
  store: WorkspaceHandleStore<StoredDirectoryHandle> | null,
): void {
  handleStore = store
  restorePromise = null
}

function initialSnapshot(): WorkspaceSnapshot {
  if (typeof window === 'undefined' || !canChooseWorkspace()) {
    if (typeof window !== 'undefined' && !canChooseWorkspace()) {
      return { status: 'unsupported', folderName: null, workspaceId: null, error: null }
    }
    return { status: 'none', folderName: null, workspaceId: null, error: null }
  }
  const pointer = readWorkspacePointer(window.localStorage)
  return {
    status: 'restoring',
    folderName: pointer?.name ?? null,
    workspaceId: pointer?.id ?? null,
    error: null,
  }
}

export function canChooseWorkspace(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
  )
}

export function getWorkspaceSnapshot(): WorkspaceSnapshot {
  return snapshot
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isWorkspaceReady(): boolean {
  return snapshot.status === 'ready' && root != null
}

/** Connects a directory the caller already holds. Does not delete any folder. */
export async function connectWorkspace(directory: WorkspaceDirectory): Promise<WorkspaceFile> {
  const opened = await openOrCreateWorkspace(directory)
  const mediaRoot = await workspaceMediaDirectory(directory)
  const cacheRoot = await workspaceCacheDirectory(directory)
  root = directory
  info = opened
  bindWorkspaceStores(
    createWorkspaceMediaStore(mediaRoot),
    createWorkspaceCacheStore(cacheRoot),
  )
  remember(opened)
  publish({
    status: 'ready',
    folderName: directory.name,
    workspaceId: opened.id,
    error: null,
  })
  return opened
}

/**
 * User gesture. Replaces the connected folder in memory and the saved handle.
 * The previous folder on disk is left as it is.
 */
export async function chooseWorkspace(): Promise<boolean> {
  await ensureWorkspaceRestored()
  if (!canChooseWorkspace()) {
    publish({ ...snapshot, status: 'unsupported', error: null })
    return false
  }
  let picked: FileSystemDirectoryHandle
  try {
    picked = await (window as DirectoryPickerWindow).showDirectoryPicker!({
      id: PICKER_ID,
      mode: 'readwrite',
    })
  } catch (error) {
    if (isAbortError(error)) return false
    publish({
      ...snapshot,
      error: error instanceof Error ? error.message : 'Could not open that folder.',
    })
    return false
  }
  const stored = picked as unknown as StoredDirectoryHandle
  const granted = await requestWritePermission(stored)
  if (!granted) {
    publish({
      ...snapshot,
      status: 'needs-permission',
      folderName: picked.name,
      error: 'Framebase needs permission to use this folder.',
    })
    return false
  }
  try {
    handle = stored
    await connectWorkspace(directoryFromHandle(picked))
    await browserHandleStore().write(stored)
    return true
  } catch (error) {
    return failHandle(error)
  }
}

/** Re-grants access from a user click. Does not run on refresh. */
export async function reconnectWorkspace(): Promise<boolean> {
  await ensureWorkspaceRestored()
  const saved = handle ?? (await browserHandleStore().read())
  if (saved) {
    const granted = await requestWritePermission(saved)
    if (!granted) {
      publish({
        ...snapshot,
        status: 'needs-permission',
        folderName: saved.name,
        error: 'Framebase needs permission to use this folder.',
      })
      return false
    }
    try {
      const directory = directoryFromHandle(saved as unknown as FileSystemDirectoryHandle)
      await openExistingWorkspace(directory)
      handle = saved
      await connectWorkspace(directory)
      await browserHandleStore().write(saved)
      return true
    } catch (error) {
      return failHandle(error)
    }
  }
  return chooseWorkspace()
}

/**
 * Reads the saved handle and reconnects when permission is already granted.
 * Does not open the directory picker and does not call requestPermission.
 */
export function ensureWorkspaceRestored(): Promise<void> {
  if (!restorePromise) {
    restorePromise = restorePersistedWorkspace().catch(() => {
      publish({
        ...snapshot,
        status: snapshot.folderName ? 'needs-permission' : 'none',
        error: 'Could not restore the workspace folder.',
      })
    })
  }
  return restorePromise
}

export async function mirrorCurrentProject(document: ProjectDocument): Promise<void> {
  if (!root) return
  await writeProjectMirror(root, document)
}

export async function removeWorkspaceProject(projectId: string): Promise<void> {
  if (!root) return
  await removeProjectDirectory(root, projectId)
}

/** Drops the in-memory connection. The saved directory handle stays. */
export function releaseWorkspaceConnection(): void {
  root = null
  handle = null
  bindWorkspaceStores(null, null)
  const pointer =
    typeof window === 'undefined' ? null : readWorkspacePointer(window.localStorage)
  publish({
    status: pointer ? 'needs-permission' : 'none',
    folderName: pointer?.name ?? info?.name ?? null,
    workspaceId: pointer?.id ?? info?.id ?? null,
    error: null,
  })
}

async function restorePersistedWorkspace(): Promise<void> {
  if (typeof window === 'undefined' || !canChooseWorkspace()) {
    if (snapshot.status === 'restoring') {
      publish({ status: 'none', folderName: null, workspaceId: null, error: null })
    }
    return
  }
  const result = await restoreStoredWorkspace({
    readHandle: () => browserHandleStore().read(),
    openDirectory: async (saved) =>
      directoryFromHandle(saved as unknown as FileSystemDirectoryHandle),
  })
  if (result.status === 'none') {
    publish({ status: 'none', folderName: null, workspaceId: null, error: null })
    return
  }
  if (result.status === 'needs-permission') {
    handle = result.handle
    publish({
      status: 'needs-permission',
      folderName: result.handle.name,
      workspaceId: snapshot.workspaceId,
      error: null,
    })
    return
  }
  if (result.status === 'invalid') {
    handle = result.handle
    publish({
      status: 'needs-permission',
      folderName: result.handle.name,
      workspaceId: null,
      error: result.message,
    })
    return
  }
  handle = result.handle
  await connectWorkspace(result.directory)
}

async function requestWritePermission(next: StoredDirectoryHandle): Promise<boolean> {
  const mode = { mode: 'readwrite' as const }
  if ((await next.queryPermission(mode)) === 'granted') return true
  return (await next.requestPermission(mode)) === 'granted'
}

function failHandle(error: unknown): boolean {
  handle = null
  bindWorkspaceStores(null, null)
  root = null
  const message =
    error instanceof WorkspaceFormatError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Could not use that folder as a workspace.'
  publish({
    ...snapshot,
    status: 'needs-permission',
    error: message,
  })
  return false
}

function remember(opened: WorkspaceFile): void {
  if (typeof window === 'undefined') return
  writeWorkspacePointer(window.localStorage, { id: opened.id, name: opened.name })
}

function publish(next: WorkspaceSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !handle) return
    void refreshPermission()
  })
}

if (typeof window !== 'undefined' && canChooseWorkspace()) {
  void ensureWorkspaceRestored()
}

async function refreshPermission(): Promise<void> {
  if (!handle || snapshot.status !== 'ready') return
  try {
    const state = await handle.queryPermission({ mode: 'readwrite' })
    if (state === 'granted') return
  } catch {
    // queryPermission can fail when the handle is no longer usable.
  }
  root = null
  bindWorkspaceStores(null, null)
  publish({
    status: 'needs-permission',
    folderName: handle.name,
    workspaceId: info?.id ?? snapshot.workspaceId,
    error: null,
  })
}
