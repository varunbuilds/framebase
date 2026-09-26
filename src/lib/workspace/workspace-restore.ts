import { openExistingWorkspace } from './workspace-layout'
import type { WorkspaceDirectory } from './workspace-types'

export type StoredDirectoryHandle = {
  readonly name: string
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
}

export type WorkspaceRestoreResult =
  | { status: 'none' }
  | { status: 'needs-permission'; handle: StoredDirectoryHandle }
  | { status: 'invalid'; handle: StoredDirectoryHandle; message: string }
  | { status: 'ready'; handle: StoredDirectoryHandle; directory: WorkspaceDirectory }

/**
 * Restores a previously chosen folder. Permission is only queried.
 * requestPermission is left to a later button click. A folder without
 * workspace.json is not initialized.
 */
export async function restoreStoredWorkspace(args: {
  readHandle: () => Promise<StoredDirectoryHandle | null>
  openDirectory: (handle: StoredDirectoryHandle) => Promise<WorkspaceDirectory>
}): Promise<WorkspaceRestoreResult> {
  const handle = await args.readHandle()
  if (!handle) return { status: 'none' }
  const permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission !== 'granted') return { status: 'needs-permission', handle }
  try {
    const directory = await args.openDirectory(handle)
    await openExistingWorkspace(directory)
    return { status: 'ready', handle, directory }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'This folder is not a Framebase workspace.'
    return { status: 'invalid', handle, message }
  }
}

/** Hydration starts only after workspace restoration has settled. */
export async function afterWorkspaceRestore<T>(
  restore: () => Promise<void>,
  next: () => Promise<T>,
): Promise<T> {
  await restore()
  return next()
}
