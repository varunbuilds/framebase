import {
  assertMediaSourceId,
  MediaStoreUnavailableError,
  type MediaByteStore,
  type MediaWrite,
  type StoredMedia,
} from './media-byte-store'
import { createMemoryMediaStore } from './memory-media-store'

const ROOT_DIRECTORY = 'framebase-media'
const UNAVAILABLE =
  'This browser cannot store imported media on this device, so it would disappear after a refresh.'

type MediaMetadata = {
  name: string
  mimeType: string
}

let activeStore: MediaByteStore | null = null
let persistRequested = false

export function isPersistentMediaAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

export function getMediaByteStore(): MediaByteStore {
  if (!activeStore) activeStore = createOpfsMediaStore()
  return activeStore
}

/** Tests inject a memory store. The app uses OPFS. */
export function setMediaByteStore(store: MediaByteStore | null): void {
  activeStore = store
}

export function createOpfsMediaStore(): MediaByteStore {
  return {
    save: saveMediaFile,
    get: getMediaFile,
    has: hasMediaFile,
    delete: deleteMediaFile,
    list: listMediaFiles,
  }
}

export async function saveMedia(
  mediaSourceId: string,
  file: Blob,
  metadata: MediaWrite,
): Promise<void> {
  await getMediaByteStore().save(mediaSourceId, file, metadata)
}

export async function getMedia(mediaSourceId: string): Promise<StoredMedia | null> {
  return getMediaByteStore().get(mediaSourceId)
}

export async function hasMedia(mediaSourceId: string): Promise<boolean> {
  return getMediaByteStore().has(mediaSourceId)
}

export async function deleteMedia(mediaSourceId: string): Promise<void> {
  await getMediaByteStore().delete(mediaSourceId)
}

export async function listMedia(): Promise<string[]> {
  return getMediaByteStore().list()
}

export { createMemoryMediaStore }

async function saveMediaFile(
  mediaSourceId: string,
  file: Blob,
  metadata: MediaWrite,
): Promise<void> {
  assertMediaSourceId(mediaSourceId)
  await ensureSpace(file.size)
  const directory = await mediaDirectory(mediaSourceId, true)
  if (!directory) throw new Error('Could not create media storage on this device.')
  await writeBlob(directory, 'source', file)
  await writeBlob(
    directory,
    'metadata.json',
    new Blob([
      JSON.stringify({
        name: metadata.name,
        mimeType: metadata.mimeType || file.type || 'application/octet-stream',
      } satisfies MediaMetadata),
    ]),
  )
}

async function getMediaFile(mediaSourceId: string): Promise<StoredMedia | null> {
  assertMediaSourceId(mediaSourceId)
  const directory = await mediaDirectory(mediaSourceId, false)
  if (!directory) return null
  const source = await readFile(directory, 'source')
  if (!source) return null
  const metadata = await readMetadata(directory)
  const mimeType = metadata?.mimeType || source.type || 'application/octet-stream'
  return {
    blob: source.type === mimeType ? source : new Blob([source], { type: mimeType }),
    name: metadata?.name || 'media',
    mimeType,
  }
}

async function hasMediaFile(mediaSourceId: string): Promise<boolean> {
  assertMediaSourceId(mediaSourceId)
  const directory = await mediaDirectory(mediaSourceId, false)
  if (!directory) return false
  return (await readFile(directory, 'source')) != null
}

async function deleteMediaFile(mediaSourceId: string): Promise<void> {
  assertMediaSourceId(mediaSourceId)
  const root = await rootDirectory()
  try {
    await root.removeEntry(mediaSourceId, { recursive: true })
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

async function listMediaFiles(): Promise<string[]> {
  const root = await rootDirectory()
  const ids: string[] = []
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === 'directory') ids.push(name)
  }
  return ids
}

async function rootDirectory(): Promise<FileSystemDirectoryHandle> {
  const storage = navigator.storage
  if (!storage.getDirectory) {
    throw new MediaStoreUnavailableError(UNAVAILABLE)
  }
  if (!persistRequested && storage.persist) {
    persistRequested = true
    try {
      await storage.persist()
    } catch {
      // Persistence is a hint. The write can still succeed without it.
    }
  }
  const origin = await storage.getDirectory()
  return origin.getDirectoryHandle(ROOT_DIRECTORY, { create: true })
}

async function mediaDirectory(
  mediaSourceId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const root = await rootDirectory()
  try {
    return await root.getDirectoryHandle(mediaSourceId, { create })
  } catch (error) {
    if (!create && isNotFound(error)) return null
    throw error
  }
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
  } finally {
    await writable.close()
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

async function readMetadata(
  directory: FileSystemDirectoryHandle,
): Promise<MediaMetadata | null> {
  const file = await readFile(directory, 'metadata.json')
  if (!file) return null
  try {
    const parsed: unknown = JSON.parse(await file.text())
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as { name?: unknown; mimeType?: unknown }
    if (typeof record.name !== 'string' || typeof record.mimeType !== 'string') {
      return null
    }
    return { name: record.name, mimeType: record.mimeType }
  } catch {
    return null
  }
}

async function ensureSpace(byteLength: number): Promise<void> {
  if (!navigator.storage?.estimate || byteLength <= 0) return
  const { quota, usage } = await navigator.storage.estimate()
  if (quota == null || usage == null) return
  if (byteLength > quota - usage) {
    throw new Error('Not enough space on this device to store this file.')
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}
