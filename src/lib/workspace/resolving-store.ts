import type { DerivedCacheStore } from '@/lib/media/derived-cache'
import {
  MediaStoreUnavailableError,
  type MediaByteStore,
} from '@/lib/media/media-byte-store'

/**
 * Workspace is the place new bytes are written. A miss falls through to the
 * legacy store so media imported before the workspace still opens. A permission
 * failure is a miss, not a deleted media source.
 */
export function createResolvingMediaStore(options: {
  workspace: () => MediaByteStore | null
  legacy: MediaByteStore | null
  unavailableMessage: string
}): MediaByteStore {
  const { workspace, legacy, unavailableMessage } = options
  return {
    async save(mediaSourceId, file, metadata) {
      const primary = workspace()
      if (!primary) throw new MediaStoreUnavailableError(unavailableMessage)
      await primary.save(mediaSourceId, file, metadata)
    },
    async get(mediaSourceId) {
      const primary = workspace()
      if (primary) {
        try {
          const stored = await primary.get(mediaSourceId)
          if (stored) return stored
        } catch (error) {
          if (!isPermissionError(error)) throw error
        }
      }
      if (!legacy) return null
      try {
        return await legacy.get(mediaSourceId)
      } catch (error) {
        if (isPermissionError(error)) return null
        throw error
      }
    },
    async has(mediaSourceId) {
      const primary = workspace()
      if (primary) {
        try {
          if (await primary.has(mediaSourceId)) return true
        } catch (error) {
          if (!isPermissionError(error)) throw error
        }
      }
      if (!legacy) return false
      try {
        return await legacy.has(mediaSourceId)
      } catch (error) {
        if (isPermissionError(error)) return false
        throw error
      }
    },
    async delete(mediaSourceId) {
      const primary = workspace()
      if (primary) await primary.delete(mediaSourceId)
      if (legacy) await legacy.delete(mediaSourceId)
    },
    async list() {
      const ids = new Set<string>()
      const primary = workspace()
      if (primary) {
        for (const id of await primary.list()) ids.add(id)
      }
      if (legacy) {
        for (const id of await legacy.list()) ids.add(id)
      }
      return [...ids]
    },
  }
}

export function createResolvingCacheStore(options: {
  workspace: () => DerivedCacheStore | null
  legacy: DerivedCacheStore | null
}): DerivedCacheStore {
  const { workspace, legacy } = options
  return {
    async get(mediaSourceId, cacheKey) {
      const primary = workspace()
      if (primary) {
        try {
          const blob = await primary.get(mediaSourceId, cacheKey)
          if (blob) return blob
        } catch (error) {
          if (!isPermissionError(error)) throw error
        }
      }
      if (!legacy) return null
      return legacy.get(mediaSourceId, cacheKey)
    },
    async set(mediaSourceId, cacheKey, blob) {
      const primary = workspace()
      const target = primary ?? legacy
      if (!target) throw new Error('No local cache is available.')
      await target.set(mediaSourceId, cacheKey, blob)
    },
    async invalidate(mediaSourceId, cacheKey) {
      const primary = workspace()
      if (primary) await primary.invalidate(mediaSourceId, cacheKey)
      if (legacy) await legacy.invalidate(mediaSourceId, cacheKey)
    },
    async deleteMedia(mediaSourceId) {
      const primary = workspace()
      if (primary) await primary.deleteMedia(mediaSourceId)
      if (legacy) await legacy.deleteMedia(mediaSourceId)
    },
    async clearAll() {
      const primary = workspace()
      if (primary) await primary.clearAll()
      if (legacy) await legacy.clearAll()
    },
  }
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  )
}
