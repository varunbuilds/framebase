import {
  assertMediaSourceId,
  type MediaByteStore,
  type StoredMedia,
} from '@/lib/media/media-byte-store'
import { openDirectoryPath, readJson, writeJson } from './directory-path'
import { buildMediaMetadata, hashBlobSha256, parseMediaMetadata } from './media-record'
import {
  getMediaDir,
  getMediaSourceFile,
  MEDIA_METADATA_FILE,
  MEDIA_THUMBNAIL_FILE,
  splitWorkspacePath,
} from './workspace-paths'
import type { WorkspaceDirectory } from './workspace-types'

/** Source bytes at media/<id>/source.<ext>, plus metadata and an optional thumbnail. */
export function createWorkspaceMediaStore(root: WorkspaceDirectory): MediaByteStore {
  return {
    async save(mediaSourceId, file, metadata) {
      assertMediaSourceId(mediaSourceId)
      const directory = await mediaDirectory(root, mediaSourceId, true)
      if (!directory) throw new Error('Could not create the workspace media folder.')
      const type = metadata.mimeType || file.type || 'application/octet-stream'
      const bytes = file.type === type ? file : new Blob([file], { type })
      const sourceName = getMediaSourceFile(metadata.name, type)
      const previous = parseMediaMetadata(
        await readJson(directory, MEDIA_METADATA_FILE),
        mediaSourceId,
      )
      await directory.writeFile(sourceName, bytes)
      const contentHash = await hashBlobSha256(bytes)
      const record = buildMediaMetadata({
        id: mediaSourceId,
        file: bytes,
        metadata: { ...metadata, mimeType: type },
        extension: sourceName.slice('source'.length),
        contentHash,
        previous,
      })
      await writeJson(directory, MEDIA_METADATA_FILE, record)
      if (metadata.thumbnail && metadata.thumbnail.size > 0) {
        await directory.writeFile(MEDIA_THUMBNAIL_FILE, metadata.thumbnail).catch(() => undefined)
      }
      await removeLegacySource(directory, sourceName)
    },
    async get(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      const directory = await mediaDirectory(root, mediaSourceId, false)
      if (!directory) return null
      return readStored(directory, mediaSourceId)
    },
    async has(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      const directory = await mediaDirectory(root, mediaSourceId, false)
      if (!directory) return false
      return (await findSource(directory)) != null
    },
    async delete(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      const mediaRoot = await root.openDirectory('media', { create: false })
      if (!mediaRoot) return
      await mediaRoot.remove(mediaSourceId, { recursive: true })
    },
    async list() {
      const mediaRoot = await root.openDirectory('media', { create: false })
      if (!mediaRoot) return []
      const entries = await mediaRoot.list()
      return entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.name)
    },
  }
}

async function mediaDirectory(
  root: WorkspaceDirectory,
  mediaSourceId: string,
  create: boolean,
): Promise<WorkspaceDirectory | null> {
  return openDirectoryPath(root, splitWorkspacePath(getMediaDir(mediaSourceId)), create)
}

async function readStored(
  directory: WorkspaceDirectory,
  mediaSourceId: string,
): Promise<StoredMedia | null> {
  const found = await findSource(directory)
  if (!found) return null
  const metadata = parseMediaMetadata(await readJson(directory, MEDIA_METADATA_FILE), mediaSourceId)
  const mimeType = metadata?.mimeType || found.blob.type || 'application/octet-stream'
  return {
    blob: found.blob.type === mimeType ? found.blob : new Blob([found.blob], { type: mimeType }),
    name: metadata?.fileName || 'media',
    mimeType,
  }
}

async function findSource(
  directory: WorkspaceDirectory,
): Promise<{ name: string; blob: Blob } | null> {
  const entries = await directory.list()
  const named = entries.filter(
    (entry) => entry.kind === 'file' && /^source\.[A-Za-z0-9]+$/.test(entry.name),
  )
  const preferred = named[0]
  if (preferred) {
    const blob = await directory.readFile(preferred.name)
    if (blob) return { name: preferred.name, blob }
  }
  const legacy = await directory.readFile('source')
  if (legacy) return { name: 'source', blob: legacy }
  return null
}

async function removeLegacySource(
  directory: WorkspaceDirectory,
  sourceName: string,
): Promise<void> {
  if (sourceName === 'source') return
  const legacy = await directory.readFile('source')
  if (!legacy) return
  const written = await directory.readFile(sourceName)
  if (written && written.size === legacy.size) {
    await directory.remove('source')
  }
}
