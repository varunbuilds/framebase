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
  listWorkspaceProjects,
  openExistingWorkspace,
  openOrCreateWorkspace,
  removeProjectDirectory,
  unreferencedMediaIds,
  writeProjectMirror,
  WorkspaceFormatError,
} from './workspace-layout'
import { createWorkspaceMediaStore } from './workspace-media-store'
import { readWorkspacePointer, writeWorkspacePointer } from './workspace-pointer'
import { knownWorkspaceViews, type KnownWorkspaceView } from './workspace-registry'
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
let connectedProjectIds: readonly string[] = []
let known: readonly KnownWorkspaceView[] = []
const handleDirectories = new WeakMap<StoredDirectoryHandle, WorkspaceDirectory>()
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

/** Tests attach a directory to a handle. The browser uses the real handle. */
export function associateWorkspaceHandle(
  stored: StoredDirectoryHandle,
  directory: WorkspaceDirectory,
): void {
  handleDirectories.set(stored, directory)
}

export function getKnownWorkspaces(): readonly KnownWorkspaceView[] {
  return known
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

export function getConnectedProjectIds(): readonly string[] {
  return connectedProjectIds
}

export function isWorkspaceReady(): boolean {
  return snapshot.status === 'ready' && root != null
}

/** Connects a directory the caller already holds. Does not delete any folder. */
export async function connectWorkspace(
  directory: WorkspaceDirectory,
  mode: 'create' | 'existing' = 'create',
): Promise<WorkspaceFile> {
  const previousRoot = root
  const previousInfo = info
  const previousIds = connectedProjectIds
  const previousSnapshot = snapshot
  connectedProjectIds = []
  publish({
    ...snapshot,
    status: 'restoring',
    folderName: directory.name,
    workspaceId: null,
    error: null,
  })
  try {
    const opened =
      mode === 'existing'
        ? await openExistingWorkspace(directory)
        : await openOrCreateWorkspace(directory)
    root = directory
    info = opened
    bindWorkspaceStores(
      createWorkspaceMediaStore(directory),
      createWorkspaceCacheStore(directory),
    )
    connectedProjectIds = (await listWorkspaceProjects(directory)).map((project) => project.id)
    remember(opened)
    publish({
      status: 'ready',
      folderName: directory.name,
      workspaceId: opened.id,
      error: null,
    })
    return opened
  } catch (error) {
    root = previousRoot
    info = previousInfo
    connectedProjectIds = previousIds
    if (previousRoot) {
      bindWorkspaceStores(
        createWorkspaceMediaStore(previousRoot),
        createWorkspaceCacheStore(previousRoot),
      )
    } else {
      bindWorkspaceStores(null, null)
    }
    publish(previousSnapshot)
    throw error
  }
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
      error: 'Framebase needs permission to use this folder.',
    })
    return false
  }
  return activateDirectory(directoryFor(stored), stored, 'create')
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
    return activateDirectory(directoryFor(saved), saved, 'existing')
  }
  return chooseWorkspace()
}

/** Switches to a workspace the user already selected. Does not copy or delete files. */
export async function switchToKnownWorkspace(workspaceId: string): Promise<boolean> {
  if (workspaceId === snapshot.workspaceId && snapshot.status === 'ready') return true
  const entries = await browserHandleStore().list()
  const entry = entries.find((item) => item.workspaceId === workspaceId)
  if (!entry) return false
  const granted = await requestWritePermission(entry.handle).catch(() => false)
  if (!granted) {
    await browserHandleStore().saveEntry({ ...entry, availability: 'needs-permission' })
    await syncKnownViews()
    publish({
      ...snapshot,
      error: `Framebase needs permission to open ${entry.name}.`,
    })
    return false
  }
  const switched = await activateDirectory(directoryFor(entry.handle), entry.handle, 'existing')
  if (!switched) {
    const latest = (await browserHandleStore().list()).find((item) => item.workspaceId === workspaceId)
    if (latest) {
      await browserHandleStore().saveEntry({ ...latest, availability: 'unavailable' })
      await syncKnownViews()
    }
  }
  return switched
}

/** Drops a workspace from the recent list. Files and cloud projects stay. */
export async function forgetKnownWorkspace(workspaceId: string): Promise<void> {
  await browserHandleStore().removeEntry(workspaceId)
  await syncKnownViews()
}

/** Explicit selection after the folder has already been picked and permitted. */
export async function selectWorkspaceDirectory(
  directory: WorkspaceDirectory,
  stored: StoredDirectoryHandle,
): Promise<boolean> {
  associateWorkspaceHandle(stored, directory)
  return activateDirectory(directory, stored, 'create')
}

async function activateDirectory(
  directory: WorkspaceDirectory,
  stored: StoredDirectoryHandle,
  mode: 'create' | 'existing',
): Promise<boolean> {
  const previousHandle = handle
  const previousInfo = info
  try {
    const opened = await connectWorkspace(directory, mode)
    handle = stored
    const store = browserHandleStore()
    if (previousHandle && previousInfo && previousInfo.id !== opened.id) {
      await store.saveEntry({
        workspaceId: previousInfo.id,
        handle: previousHandle,
        name: previousInfo.name,
        lastUsedAt: new Date(Date.now() - 1).toISOString(),
        availability: 'available',
      })
    }
    await store.write(stored)
    await store.saveEntry({
      workspaceId: opened.id,
      handle: stored,
      name: opened.name,
      lastUsedAt: new Date().toISOString(),
      availability: 'available',
    })
    await syncKnownViews()
    return true
  } catch (error) {
    const message =
      error instanceof WorkspaceFormatError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not use that folder as a workspace.'
    publish({ ...snapshot, error: message })
    await syncKnownViews()
    return false
  }
}

function directoryFor(stored: StoredDirectoryHandle): WorkspaceDirectory {
  return (
    handleDirectories.get(stored) ??
    directoryFromHandle(stored as unknown as FileSystemDirectoryHandle)
  )
}

async function syncKnownViews(): Promise<void> {
  const entries = await browserHandleStore().list()
  const active =
    snapshot.workspaceId && snapshot.folderName
      ? { workspaceId: snapshot.workspaceId, name: snapshot.folderName }
      : null
  known = knownWorkspaceViews(entries, active)
  publish({ ...snapshot })
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

export async function listConnectedWorkspaceProjects(): Promise<
  Awaited<ReturnType<typeof listWorkspaceProjects>>
> {
  if (!root) return []
  return listWorkspaceProjects(root)
}

export async function mirrorCurrentProject(document: ProjectDocument): Promise<void> {
  if (!root) return
  await writeProjectMirror(root, document)
  connectedProjectIds = (await listWorkspaceProjects(root)).map((project) => project.id)
  publish({ ...snapshot })
}

export async function removeWorkspaceProject(projectId: string): Promise<void> {
  if (!root) return
  await removeProjectDirectory(root, projectId)
  connectedProjectIds = (await listWorkspaceProjects(root)).map((project) => project.id)
  publish({ ...snapshot })
}

/** Media ids in this project that no other local project mirror lists. Not a cloud ownership check. */
export async function localMediaIdsNotMirroredElsewhere(
  projectId: string,
  mediaIds: string[],
): Promise<string[]> {
  if (!root) return mediaIds
  return unreferencedMediaIds(root, projectId, mediaIds)
}

/** Drops the in-memory connection. The saved directory handle stays. */
export function releaseWorkspaceConnection(): void {
  root = null
  handle = null
  connectedProjectIds = []
  known = []
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
    openDirectory: async (saved) => directoryFor(saved),
  })
  if (result.status === 'none') {
    publish({ status: 'none', folderName: null, workspaceId: null, error: null })
    await syncKnownViews()
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
    await syncKnownViews()
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
    await syncKnownViews()
    return
  }
  handle = result.handle
  await connectWorkspace(result.directory)
  await syncKnownViews()
}

async function requestWritePermission(next: StoredDirectoryHandle): Promise<boolean> {
  const mode = { mode: 'readwrite' as const }
  if ((await next.queryPermission(mode)) === 'granted') return true
  return (await next.requestPermission(mode)) === 'granted'
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
  connectedProjectIds = []
  bindWorkspaceStores(null, null)
  publish({
    status: 'needs-permission',
    folderName: handle.name,
    workspaceId: info?.id ?? snapshot.workspaceId,
    error: null,
  })
}
