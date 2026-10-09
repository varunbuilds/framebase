/**
 * IndexedDB stores directory handles for workspaces the user has selected.
 * It does not store filesystem paths, media bytes, project documents, caches,
 * or credentials.
 *
 * `selected` remains the current handle so an older record that stored only
 * that handle still restores. `workspaces` is the recent-workspace registry.
 */

export const WORKSPACE_HANDLE_DB = 'framebase-workspace'
export const WORKSPACE_HANDLE_STORE = 'directory-handle'
export const WORKSPACE_HANDLE_KEY = 'selected'
export const WORKSPACE_REGISTRY_KEY = 'workspaces'
const WORKSPACE_HANDLE_DB_VERSION = 2

export type WorkspaceAvailability = 'available' | 'needs-permission' | 'unavailable'

export type WorkspaceRegistryEntry<T> = {
  workspaceId: string
  handle: T
  name: string
  lastUsedAt: string
  availability: WorkspaceAvailability
}

export interface WorkspaceHandleStore<T> {
  read(): Promise<T | null>
  write(value: T): Promise<void>
  list(): Promise<WorkspaceRegistryEntry<T>[]>
  saveEntry(entry: WorkspaceRegistryEntry<T>): Promise<void>
  removeEntry(workspaceId: string): Promise<void>
}

/** A legacy IndexedDB value is the handle itself, not a registry record. */
export function readSelectedHandle<T>(stored: unknown): T | null {
  if (typeof stored !== 'object' || stored === null) return null
  if (!('queryPermission' in stored)) return null
  return stored as T
}

export function upsertWorkspaceEntry<T>(
  entries: readonly WorkspaceRegistryEntry<T>[],
  entry: WorkspaceRegistryEntry<T>,
): WorkspaceRegistryEntry<T>[] {
  return [...entries.filter((item) => item.workspaceId !== entry.workspaceId), entry].sort((a, b) =>
    b.lastUsedAt.localeCompare(a.lastUsedAt),
  )
}

export function withoutWorkspaceEntry<T>(
  entries: readonly WorkspaceRegistryEntry<T>[],
  workspaceId: string,
): WorkspaceRegistryEntry<T>[] {
  return entries.filter((item) => item.workspaceId !== workspaceId)
}

export function createMemoryWorkspaceHandleStore<T>(): WorkspaceHandleStore<T> & {
  records(): T[]
} {
  let current: T | null = null
  let entries: WorkspaceRegistryEntry<T>[] = []
  const history: T[] = []
  return {
    async read() {
      return current
    },
    async write(value) {
      current = value
      history.push(value)
    },
    async list() {
      return entries.map((entry) => ({ ...entry }))
    },
    async saveEntry(entry) {
      entries = upsertWorkspaceEntry(entries, entry)
    },
    async removeEntry(workspaceId) {
      entries = withoutWorkspaceEntry(entries, workspaceId)
    },
    records() {
      return [...history]
    },
  }
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function openHandleDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(WORKSPACE_HANDLE_DB, WORKSPACE_HANDLE_DB_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(WORKSPACE_HANDLE_STORE)) {
      database.createObjectStore(WORKSPACE_HANDLE_STORE)
    }
  }
  return settle(request)
}

function parseRegistry<T>(stored: unknown): WorkspaceRegistryEntry<T>[] {
  if (!Array.isArray(stored)) return []
  return stored.filter((entry): entry is WorkspaceRegistryEntry<T> => {
    if (typeof entry !== 'object' || entry === null) return false
    const record = entry as Partial<WorkspaceRegistryEntry<T>>
    return (
      typeof record.workspaceId === 'string' &&
      typeof record.name === 'string' &&
      typeof record.lastUsedAt === 'string' &&
      (record.availability === 'available' ||
        record.availability === 'needs-permission' ||
        record.availability === 'unavailable') &&
      typeof record.handle === 'object' &&
      record.handle !== null
    )
  })
}

/** Browser store. `selected` is the current handle. `workspaces` is the registry. */
export function createIndexedDbWorkspaceHandleStore<T>(
  factory: IDBFactory,
): WorkspaceHandleStore<T> {
  return {
    async read() {
      const database = await openHandleDatabase(factory)
      try {
        const request = database
          .transaction(WORKSPACE_HANDLE_STORE, 'readonly')
          .objectStore(WORKSPACE_HANDLE_STORE)
          .get(WORKSPACE_HANDLE_KEY)
        return readSelectedHandle<T>(await settle(request))
      } finally {
        database.close()
      }
    },
    async write(value) {
      const database = await openHandleDatabase(factory)
      try {
        const request = database
          .transaction(WORKSPACE_HANDLE_STORE, 'readwrite')
          .objectStore(WORKSPACE_HANDLE_STORE)
          .put(value, WORKSPACE_HANDLE_KEY)
        await settle(request)
      } finally {
        database.close()
      }
    },
    async list() {
      const database = await openHandleDatabase(factory)
      try {
        const request = database
          .transaction(WORKSPACE_HANDLE_STORE, 'readonly')
          .objectStore(WORKSPACE_HANDLE_STORE)
          .get(WORKSPACE_REGISTRY_KEY)
        return parseRegistry<T>(await settle(request))
      } finally {
        database.close()
      }
    },
    async saveEntry(entry) {
      const database = await openHandleDatabase(factory)
      try {
        const transaction = database.transaction(WORKSPACE_HANDLE_STORE, 'readwrite')
        const store = transaction.objectStore(WORKSPACE_HANDLE_STORE)
        const current = parseRegistry<T>(await settle(store.get(WORKSPACE_REGISTRY_KEY)))
        await settle(store.put(upsertWorkspaceEntry(current, entry), WORKSPACE_REGISTRY_KEY))
      } finally {
        database.close()
      }
    },
    async removeEntry(workspaceId) {
      const database = await openHandleDatabase(factory)
      try {
        const transaction = database.transaction(WORKSPACE_HANDLE_STORE, 'readwrite')
        const store = transaction.objectStore(WORKSPACE_HANDLE_STORE)
        const current = parseRegistry<T>(await settle(store.get(WORKSPACE_REGISTRY_KEY)))
        await settle(
          store.put(withoutWorkspaceEntry(current, workspaceId), WORKSPACE_REGISTRY_KEY),
        )
      } finally {
        database.close()
      }
    },
  }
}
