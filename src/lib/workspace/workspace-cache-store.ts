import { assertCacheKey, type DerivedCacheStore } from '@/lib/media/derived-cache'
import { assertMediaSourceId } from '@/lib/media/media-byte-store'
import { openDirectoryPath } from './directory-path'
import type { WorkspaceDirectory } from './workspace-types'

/** Rebuildable files at cache/<mediaSourceId>/<cache key>. Not source media. */
export function createWorkspaceCacheStore(cacheRoot: WorkspaceDirectory): DerivedCacheStore {
  return {
    async get(mediaSourceId, cacheKey) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      const directory = await openDirectoryPath(
        cacheRoot,
        [mediaSourceId, ...parentSegments(cacheKey)],
        false,
      )
      if (!directory) return null
      return directory.readFile(fileName(cacheKey))
    },
    async set(mediaSourceId, cacheKey, blob) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      const directory = await openDirectoryPath(
        cacheRoot,
        [mediaSourceId, ...parentSegments(cacheKey)],
        true,
      )
      if (!directory) throw new Error('Could not create the workspace cache folder.')
      await directory.writeFile(fileName(cacheKey), blob)
    },
    async invalidate(mediaSourceId, cacheKey) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      const directory = await openDirectoryPath(
        cacheRoot,
        [mediaSourceId, ...parentSegments(cacheKey)],
        false,
      )
      if (!directory) return
      await directory.remove(fileName(cacheKey))
    },
    async deleteMedia(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      await cacheRoot.remove(mediaSourceId, { recursive: true })
    },
    async clearAll() {
      const entries = await cacheRoot.list()
      await Promise.all(
        entries.map((entry) => cacheRoot.remove(entry.name, { recursive: true })),
      )
    },
  }
}

function parentSegments(cacheKey: string): string[] {
  return cacheKey.split('/').slice(0, -1)
}

function fileName(cacheKey: string): string {
  return cacheKey.split('/').at(-1) ?? cacheKey
}
