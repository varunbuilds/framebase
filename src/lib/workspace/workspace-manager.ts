import type { ProjectDocument } from '@/types/timeline'
import { directoryFromHandle } from './file-system-directory'
import { bindWorkspaceStores } from './store-binding'
import {
  createWorkspaceCacheStore,
} from './workspace-cache-store'
import {
  openOrCreateWorkspace,
  removeProjectDirectory,
  workspaceCacheDirectory,
  workspaceMediaDirectory,
  writeProjectMirror,
  WorkspaceFormatError,
} from './workspace-layout'
import { createWorkspaceMediaStore } from './workspace-media-store'
import { readWorkspacePointer, writeWorkspacePointer } from './workspace-pointer'
import type { WorkspaceDirectory, WorkspaceFile, WorkspaceSnapshot } from './workspace-types'

const PICKER_ID = 'framebase-workspace'

type WritableDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }) => Promise<FileSystemDirectoryHandle>
}

let root: WorkspaceDirectory | null = null
let info: WorkspaceFile | null = null
let handle: WritableDirectoryHandle | null = null
let snapshot: WorkspaceSnapshot = initialSnapshot()
const listeners = new Set<() => void>()

function initialSnapshot(): WorkspaceSnapshot {
  if (typeof window === 'undefined') {
    return { status: 'none', folderName: null, workspaceId: null, error: null }
  }
  if (!canChooseWorkspace()) {
    return { status: 'unsupported', folderName: null, workspaceId: null, error: null }
  }
  const pointer = readWorkspacePointer(window.localStorage)
  if (!pointer) {
    return { status: 'none', folderName: null, workspaceId: null, error: null }
  }
  return {
    status: 'needs-permission',
    folderName: pointer.name,
    workspaceId: pointer.id,
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
 * User gesture. Replaces the connected folder in memory only.
 * The previous folder on disk is left as it is.
 */
export async function chooseWorkspace(): Promise<boolean> {
  if (!canChooseWorkspace()) {
    publish({ ...snapshot, status: 'unsupported', error: null })
    return false
  }
  let picked: WritableDirectoryHandle
  try {
    picked = (await (window as DirectoryPickerWindow).showDirectoryPicker!({
      id: PICKER_ID,
      mode: 'readwrite',
    })) as WritableDirectoryHandle
  } catch (error) {
    if (isAbortError(error)) return false
    publish({
      ...snapshot,
      error: error instanceof Error ? error.message : 'Could not open that folder.',
    })
    return false
  }
  return adoptHandle(picked)
}

/** Re-grants access to the folder chosen earlier in this session, or opens the picker. */
export async function reconnectWorkspace(): Promise<boolean> {
  if (handle) {
    const permission = await requestWritePermission(handle)
    if (permission) return adoptHandle(handle)
  }
  return chooseWorkspace()
}

export async function mirrorCurrentProject(document: ProjectDocument): Promise<void> {
  if (!root) return
  await writeProjectMirror(root, document)
}

export async function removeWorkspaceProject(projectId: string): Promise<void> {
  if (!root) return
  await removeProjectDirectory(root, projectId)
}

/** Drops the in-memory handle. Used when permission is gone and by tests. */
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

async function adoptHandle(next: WritableDirectoryHandle): Promise<boolean> {
  const granted = await requestWritePermission(next)
  if (!granted) {
    publish({
      ...snapshot,
      status: 'needs-permission',
      folderName: next.name,
      error: 'Framebase needs permission to use this folder.',
    })
    return false
  }
  try {
    handle = next
    await connectWorkspace(directoryFromHandle(next))
    return true
  } catch (error) {
    handle = null
    bindWorkspaceStores(null, null)
    root = null
    const message =
      error instanceof WorkspaceFormatError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not use that folder as a workspace.'
    publish({ ...snapshot, error: message })
    return false
  }
}

async function requestWritePermission(next: WritableDirectoryHandle): Promise<boolean> {
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
    if (document.visibilityState !== 'visible') return
    void refreshPermission()
  })
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
