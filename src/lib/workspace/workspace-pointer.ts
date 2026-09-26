const POINTER_KEY = 'framebase.workspace.pointer'

export type WorkspacePointer = {
  id: string
  name: string
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Folder name and workspace id only. Not a path and not a directory handle. */
export function readWorkspacePointer(storage: KeyValueStore): WorkspacePointer | null {
  const raw = storage.getItem(POINTER_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as { id?: unknown; name?: unknown }
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || !record.name) {
      return null
    }
    if ('path' in (parsed as object) || 'handle' in (parsed as object)) return null
    return { id: record.id, name: record.name }
  } catch {
    return null
  }
}

export function writeWorkspacePointer(storage: KeyValueStore, pointer: WorkspacePointer): void {
  storage.setItem(POINTER_KEY, JSON.stringify({ id: pointer.id, name: pointer.name }))
}

export function clearWorkspacePointer(storage: KeyValueStore): void {
  storage.removeItem(POINTER_KEY)
}
