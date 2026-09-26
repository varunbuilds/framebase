/**
 * Only the selected directory handle belongs here.
 * Source media, ProjectDocument, caches, credentials, and filesystem paths do not.
 */

export const WORKSPACE_HANDLE_DB = 'framebase-workspace'
export const WORKSPACE_HANDLE_STORE = 'directory-handle'
export const WORKSPACE_HANDLE_KEY = 'selected'

export interface WorkspaceHandleStore<T> {
  read(): Promise<T | null>
  write(value: T): Promise<void>
}

export function createMemoryWorkspaceHandleStore<T>(): WorkspaceHandleStore<T> & {
  records(): T[]
} {
  let current: T | null = null
  const history: T[] = []
  return {
    async read() {
      return current
    },
    async write(value) {
      current = value
      history.push(value)
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
  const request = factory.open(WORKSPACE_HANDLE_DB, 1)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(WORKSPACE_HANDLE_STORE)) {
      database.createObjectStore(WORKSPACE_HANDLE_STORE)
    }
  }
  return settle(request)
}

/** Browser store. The only record is the directory handle under one key. */
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
        const value = await settle(request)
        return (value ?? null) as T | null
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
  }
}
