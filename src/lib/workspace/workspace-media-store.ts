import {
  assertMediaSourceId,
  type MediaByteStore,
  type StoredMedia,
} from '@/lib/media/media-byte-store'
import { openDirectoryPath, readJson } from './directory-path'
import type { WorkspaceDirectory } from './workspace-types'

type MediaMetadata = { name: string; mimeType: string }

/** Source bytes at media/<mediaSourceId>/source. The user's original file is only read. */
export function createWorkspaceMediaStore(mediaRoot: WorkspaceDirectory): MediaByteStore {
  return {
    async save(mediaSourceId, file, metadata) {
      assertMediaSourceId(mediaSourceId)
      const directory = await mediaDirectory(mediaRoot, mediaSourceId, true)
      if (!directory) throw new Error('Could not create the workspace media folder.')
      const copied = new Uint8Array(await file.arrayBuffer())
      const buffer = new ArrayBuffer(copied.byteLength)
      new Uint8Array(buffer).set(copied)
      const bytes = new Blob([buffer], {
        type: metadata.mimeType || file.type || 'application/octet-stream',
      })
      await directory.writeFile('source', bytes)
      await directory.writeFile(
        'metadata.json',
        new Blob([
          JSON.stringify({
            name: metadata.name,
            mimeType: bytes.type,
          } satisfies MediaMetadata),
        ]),
      )
    },
    async get(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      const directory = await mediaDirectory(mediaRoot, mediaSourceId, false)
      if (!directory) return null
      return readStored(directory)
    },
    async has(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      const directory = await mediaDirectory(mediaRoot, mediaSourceId, false)
      if (!directory) return false
      return (await directory.readFile('source')) != null
    },
    async delete(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      await mediaRoot.remove(mediaSourceId, { recursive: true })
    },
    async list() {
      const entries = await mediaRoot.list()
      return entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.name)
    },
  }
}

async function mediaDirectory(
  mediaRoot: WorkspaceDirectory,
  mediaSourceId: string,
  create: boolean,
): Promise<WorkspaceDirectory | null> {
  return openDirectoryPath(mediaRoot, [mediaSourceId], create)
}

async function readStored(directory: WorkspaceDirectory): Promise<StoredMedia | null> {
  const source = await directory.readFile('source')
  if (!source) return null
  const metadata = await readMetadata(directory)
  const mimeType = metadata?.mimeType || source.type || 'application/octet-stream'
  return {
    blob: source.type === mimeType ? source : new Blob([source], { type: mimeType }),
    name: metadata?.name || 'media',
    mimeType,
  }
}

async function readMetadata(directory: WorkspaceDirectory): Promise<MediaMetadata | null> {
  const parsed = await readJson(directory, 'metadata.json')
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as { name?: unknown; mimeType?: unknown }
  if (typeof record.name !== 'string' || typeof record.mimeType !== 'string') return null
  return { name: record.name, mimeType: record.mimeType }
}
