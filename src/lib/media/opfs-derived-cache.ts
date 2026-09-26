import { assertCacheKey, type DerivedCacheStore } from './derived-cache'
import { assertMediaSourceId } from './media-byte-store'

/** Rebuildable filmstrips and waveforms. Not the original source file. */
const ROOT_DIRECTORY = 'framebase-cache'

let persistRequested = false

export function createOpfsDerivedCacheStore(): DerivedCacheStore {
  return {
    get: readCache,
    set: writeCache,
    invalidate: invalidateCache,
    deleteMedia: deleteMediaCache,
    clearAll: clearCacheRoot,
  }
}

async function readCache(
  mediaSourceId: string,
  cacheKey: string,
): Promise<Blob | null> {
  assertMediaSourceId(mediaSourceId)
  assertCacheKey(cacheKey)
  const directory = await cacheDirectory(mediaSourceId, parentKey(cacheKey), false)
  if (!directory) return null
  return readFile(directory, fileName(cacheKey))
}

async function writeCache(
  mediaSourceId: string,
  cacheKey: string,
  blob: Blob,
): Promise<void> {
  assertMediaSourceId(mediaSourceId)
  assertCacheKey(cacheKey)
  const directory = await cacheDirectory(mediaSourceId, parentKey(cacheKey), true)
  if (!directory) throw new Error('Could not create media cache on this device.')
  await writeBlob(directory, fileName(cacheKey), blob)
}

async function invalidateCache(mediaSourceId: string, cacheKey: string): Promise<void> {
  assertMediaSourceId(mediaSourceId)
  assertCacheKey(cacheKey)
  const directory = await cacheDirectory(mediaSourceId, parentKey(cacheKey), false)
  if (!directory) return
  await removeEntry(directory, fileName(cacheKey))
}

async function deleteMediaCache(mediaSourceId: string): Promise<void> {
  assertMediaSourceId(mediaSourceId)
  const root = await rootDirectory(false)
  if (!root) return
  await removeEntry(root, mediaSourceId, true)
}

async function clearCacheRoot(): Promise<void> {
  const storage = navigator.storage
  if (!storage.getDirectory) return
  const origin = await storage.getDirectory()
  try {
    await origin.removeEntry(ROOT_DIRECTORY, { recursive: true })
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

function parentKey(cacheKey: string): string {
  const segments = cacheKey.split('/')
  segments.pop()
  return segments.join('/')
}

function fileName(cacheKey: string): string {
  return cacheKey.split('/').at(-1) ?? cacheKey
}

async function rootDirectory(
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const storage = navigator.storage
  if (!storage?.getDirectory) {
    throw new Error('This browser cannot store media caches.')
  }
  if (!persistRequested && storage.persist) {
    persistRequested = true
    try {
      await storage.persist()
    } catch {
      // Persistence is a hint. A cache write can still succeed without it.
    }
  }
  const origin = await storage.getDirectory()
  try {
    return await origin.getDirectoryHandle(ROOT_DIRECTORY, { create })
  } catch (error) {
    if (!create && isNotFound(error)) return null
    throw error
  }
}

async function cacheDirectory(
  mediaSourceId: string,
  parent: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let directory = await rootDirectory(create)
  if (!directory) return null
  const segments = [mediaSourceId, ...parent.split('/').filter(Boolean)]
  for (const segment of segments) {
    try {
      directory = await directory.getDirectoryHandle(segment, { create })
    } catch (error) {
      if (!create && isNotFound(error)) return null
      throw error
    }
  }
  return directory
}

async function writeBlob(
  directory: FileSystemDirectoryHandle,
  name: string,
  blob: Blob,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    try {
      await writable.abort()
    } catch {
      // The stream may already be closed.
    }
    await removeEntry(directory, name)
    throw error
  }
}

async function readFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<File | null> {
  try {
    const handle = await directory.getFileHandle(name)
    return await handle.getFile()
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function removeEntry(
  directory: FileSystemDirectoryHandle,
  name: string,
  recursive = false,
): Promise<void> {
  try {
    await directory.removeEntry(name, { recursive })
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}
