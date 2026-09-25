import {
  assertMediaSourceId,
  type MediaByteStore,
  type MediaWrite,
  type StoredMedia,
} from './media-byte-store'

/** In-memory stand-in for tests. It does not persist across reloads. */
export function createMemoryMediaStore(): MediaByteStore {
  const files = new Map<string, StoredMedia>()

  return {
    async save(mediaSourceId, file, metadata: MediaWrite) {
      assertMediaSourceId(mediaSourceId)
      const blob = new Blob([await file.arrayBuffer()], {
        type: metadata.mimeType || file.type || 'application/octet-stream',
      })
      files.set(mediaSourceId, {
        blob,
        name: metadata.name,
        mimeType: blob.type,
      })
    },
    async get(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      return files.get(mediaSourceId) ?? null
    },
    async has(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      return files.has(mediaSourceId)
    },
    async delete(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      files.delete(mediaSourceId)
    },
    async list() {
      return [...files.keys()]
    },
  }
}
