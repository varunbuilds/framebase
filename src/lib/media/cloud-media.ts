import { assertMediaSourceId } from '@/lib/media/media-byte-store'
import type { MediaSource, RemoteMediaReference } from '@/types/timeline'
import type { CloudTransfer } from './cloud-transfer'

/** Private bucket. Filmstrips and waveforms never belong in this bucket. */
export const SOURCE_MEDIA_BUCKET = 'framebase-source-media'

/**
 * Stable object path. The original filename stays on MediaSource.name.
 * media ids are unique per import, so one path belongs to one source.
 */
export function sourceStoragePath(mediaSourceId: string): string {
  assertMediaSourceId(mediaSourceId)
  return `media/${mediaSourceId}/source`
}

export function isSourceStoragePath(path: string): boolean {
  return /^media\/[A-Za-z0-9_-]+\/source$/.test(path)
}

export class CloudMediaError extends Error {
  readonly code: 'logged-out' | 'denied' | 'failed'

  constructor(code: CloudMediaError['code'], message: string) {
    super(message)
    this.name = 'CloudMediaError'
    this.code = code
  }
}

export type SourceStorageClient = {
  upload(args: {
    path: string
    body: Blob
    contentType: string
    onProgress?: (loaded: number, total: number) => void
  }): Promise<void>
  download(path: string): Promise<Blob>
  remove(paths: string[]): Promise<void>
}

export function remoteReference(
  mediaSourceId: string,
  sizeBytes: number,
  uploadedAt: string,
): RemoteMediaReference {
  return {
    assetId: mediaSourceId,
    storagePath: sourceStoragePath(mediaSourceId),
    sizeBytes,
    uploadedAt,
  }
}

/**
 * Local playback and the cloud copy are separate. Upload progress is not
 * part of this description and must not be written into ProjectDocument.
 */
export function describeCloudMedia(input: {
  local: boolean
  remote: boolean
  transfer: CloudTransfer | null
}): { text: string; action: 'download' | 'upload' | 'retry' | null } {
  const transfer = input.transfer
  if (transfer?.phase === 'uploading') {
    return { text: progressLabel('↑ Uploading', transfer.progress), action: null }
  }
  if (transfer?.phase === 'downloading') {
    return { text: progressLabel('↓ Downloading', transfer.progress), action: null }
  }
  if (input.local && input.remote) return { text: '✓ Synced', action: null }
  if (input.local) return { text: '✓ Local', action: 'upload' }
  if (input.remote && transfer?.phase === 'error') {
    return { text: '☁ Available in cloud', action: 'retry' }
  }
  if (input.remote) return { text: '☁ Available in cloud', action: 'download' }
  return { text: '⚠ Media unavailable', action: null }
}

function progressLabel(prefix: string, progress: number | null): string {
  if (progress == null || !Number.isFinite(progress)) return prefix
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)))
  return `${prefix} ${percent}%`
}

/**
 * The local copy already exists. Saving the project document must happen
 * before the upload, because storage access follows the project row.
 * A failed upload leaves the local file in place.
 */
export async function uploadVerifiedLocalSource(args: {
  source: MediaSource
  readLocal: () => Promise<Blob | null>
  authenticated: () => boolean | Promise<boolean>
  persistProject: () => Promise<void>
  client: SourceStorageClient
  uploadedAt?: string
  onProgress?: (ratio: number) => void
}): Promise<RemoteMediaReference> {
  if (!(await args.authenticated())) {
    throw new CloudMediaError('logged-out', 'Sign in to upload media.')
  }
  const local = await args.readLocal()
  if (!local) {
    throw new CloudMediaError('failed', 'The local media file is missing.')
  }
  await args.persistProject()
  const path = sourceStoragePath(args.source.id)
  await args.client.upload({
    path,
    body: local,
    contentType: local.type || args.source.mimeType || 'application/octet-stream',
    onProgress: (loaded, total) => {
      if (total > 0) args.onProgress?.(loaded / total)
    },
  })
  return remoteReference(args.source.id, local.size, args.uploadedAt ?? new Date().toISOString())
}

/**
 * Downloads into the workspace source slot and checks the size before the
 * file is treated as available. An existing local file is not downloaded again.
 */
export async function downloadRemoteSource(args: {
  source: MediaSource
  hasLocal: () => Promise<boolean>
  authenticated: () => boolean | Promise<boolean>
  client: SourceStorageClient
  writeLocal: (body: Blob) => Promise<void>
  readLocal: () => Promise<Blob | null>
  deleteLocal: () => Promise<void>
}): Promise<'downloaded' | 'skipped'> {
  if (await args.hasLocal()) return 'skipped'
  const remote = args.source.remote
  if (!remote) throw new CloudMediaError('failed', 'This media has no cloud copy.')
  if (remote.storagePath !== sourceStoragePath(args.source.id)) {
    throw new CloudMediaError('failed', 'The cloud media path does not match this media.')
  }
  if (!(await args.authenticated())) {
    throw new CloudMediaError('logged-out', 'Sign in to download media.')
  }
  const body = await args.client.download(remote.storagePath)
  if (body.size !== remote.sizeBytes) {
    throw new CloudMediaError('failed', 'The downloaded file size does not match.')
  }
  try {
    await args.writeLocal(body)
    const written = await args.readLocal()
    if (!written || written.size !== remote.sizeBytes) {
      await args.deleteLocal()
      throw new CloudMediaError('failed', 'The saved media file does not match.')
    }
  } catch (error) {
    await args.deleteLocal().catch(() => undefined)
    throw error
  }
  return 'downloaded'
}

/**
 * Paths to delete with the project. A media id referenced by another project
 * is left in the bucket. There is no global media garbage collector.
 * Assumption: each import creates its own mediaSourceId, so a count above 1
 * means another project document lists that same id.
 */
export async function cloudPathsForProjectDeletion(
  document: { mediaSources: MediaSource[] },
  countProjectsWithMedia: (mediaSourceId: string) => Promise<number>,
): Promise<string[]> {
  const paths: string[] = []
  for (const source of document.mediaSources) {
    const remote = source.remote
    if (!remote) continue
    if (remote.assetId !== source.id) continue
    if (remote.storagePath !== sourceStoragePath(source.id)) continue
    const count = await countProjectsWithMedia(source.id)
    if (count > 1) continue
    paths.push(remote.storagePath)
  }
  return paths
}
