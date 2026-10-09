import {
  FILMSTRIP_FRAME_HEIGHT,
  FILMSTRIP_VERSION,
  WAVEFORM_VERSION,
  assertCacheKey,
  type DerivedCacheStore,
} from '@/lib/media/derived-cache'
import { assertMediaSourceId } from '@/lib/media/media-byte-store'
import { openDirectoryPath, readJson, writeJson } from './directory-path'
import { parseMediaMetadata } from './media-record'
import {
  LEGACY_CACHE_DIRECTORY,
  MEDIA_DIRECTORY,
  MEDIA_METADATA_FILE,
} from './workspace-paths'
import type { WorkspaceDirectory } from './workspace-types'

const FILMSTRIP_QUALITY_PERCENT = 86

/** Rebuildable files at media/<id>/cache/<cache key>. Not source media. */
export function createWorkspaceCacheStore(root: WorkspaceDirectory): DerivedCacheStore {
  return {
    async get(mediaSourceId, cacheKey) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      const directory = await cacheDirectory(root, mediaSourceId, parentSegments(cacheKey), false)
      if (!directory) return null
      return directory.readFile(fileName(cacheKey))
    },
    async set(mediaSourceId, cacheKey, blob) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      const directory = await cacheDirectory(root, mediaSourceId, parentSegments(cacheKey), true)
      if (!directory) throw new Error('Could not create the workspace cache folder.')
      await directory.writeFile(fileName(cacheKey), blob)
      await writeCacheManifest(root, mediaSourceId, cacheKey).catch(() => undefined)
    },
    async invalidate(mediaSourceId, cacheKey) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      const directory = await cacheDirectory(root, mediaSourceId, parentSegments(cacheKey), false)
      if (!directory) return
      await directory.remove(fileName(cacheKey))
    },
    async deleteMedia(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      const mediaDir = await openDirectoryPath(root, [MEDIA_DIRECTORY, mediaSourceId], false)
      if (!mediaDir) return
      await mediaDir.remove('cache', { recursive: true })
    },
    async clearAll() {
      const mediaRoot = await root.openDirectory(MEDIA_DIRECTORY, { create: false })
      if (mediaRoot) {
        for (const entry of await mediaRoot.list()) {
          if (entry.kind !== 'directory') continue
          const mediaDir = await mediaRoot.openDirectory(entry.name, { create: false })
          if (mediaDir) await mediaDir.remove('cache', { recursive: true })
        }
      }
      await root.remove(LEGACY_CACHE_DIRECTORY, { recursive: true })
    },
  }
}

async function cacheDirectory(
  root: WorkspaceDirectory,
  mediaSourceId: string,
  segments: string[],
  create: boolean,
): Promise<WorkspaceDirectory | null> {
  return openDirectoryPath(
    root,
    [MEDIA_DIRECTORY, mediaSourceId, 'cache', ...segments],
    create,
  )
}

async function writeCacheManifest(
  root: WorkspaceDirectory,
  mediaSourceId: string,
  cacheKey: string,
): Promise<void> {
  const kind = cacheKey.startsWith('filmstrip/')
    ? 'filmstrip'
    : cacheKey.startsWith('waveform/')
      ? 'waveform'
      : null
  if (!kind) return
  const directory = await openDirectoryPath(
    root,
    [MEDIA_DIRECTORY, mediaSourceId, 'cache', kind],
    true,
  )
  if (!directory) return
  const mediaDir = await openDirectoryPath(root, [MEDIA_DIRECTORY, mediaSourceId], false)
  const metadata = mediaDir
    ? parseMediaMetadata(await readJson(mediaDir, MEDIA_METADATA_FILE), mediaSourceId)
    : null
  const peakCount = /peaks-(\d+)\.bin$/.exec(cacheKey)?.[1]
  const manifest = {
    mediaId: mediaSourceId,
    kind,
    version: kind === 'filmstrip' ? FILMSTRIP_VERSION : WAVEFORM_VERSION,
    ...(kind === 'filmstrip'
      ? { height: FILMSTRIP_FRAME_HEIGHT, jpegQuality: FILMSTRIP_QUALITY_PERCENT, complete: false }
      : {
          peakCount: peakCount ? Number(peakCount) : undefined,
          complete: true,
        }),
    ...(metadata?.contentHash ? { contentHash: metadata.contentHash } : {}),
    updatedAt: new Date().toISOString(),
  }
  await writeJson(directory, 'meta.json', manifest)
}

function parentSegments(cacheKey: string): string[] {
  return cacheKey.split('/').slice(0, -1)
}

function fileName(cacheKey: string): string {
  return cacheKey.split('/').at(-1) ?? cacheKey
}
