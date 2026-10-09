import type { MediaWrite } from '@/lib/media/media-byte-store'

/** Local workspace record for one media asset. Not part of ProjectDocument. */
export type MediaMetadataRecord = {
  id: string
  storageType: 'workspace'
  fileName: string
  fileSize: number
  mimeType: string
  extension: string
  durationMs?: number
  width?: number
  height?: number
  fps?: number
  hasVideo?: boolean
  hasAudio?: boolean
  videoCodec?: string
  audioCodec?: string
  sampleRate?: number
  channelCount?: number
  videoCodecSupported?: boolean
  audioCodecSupported?: boolean
  contentHash?: string
  thumbnailId?: string
  createdAt: string
  updatedAt: string
}

export function buildMediaMetadata(args: {
  id: string
  file: Blob
  metadata: MediaWrite
  extension: string
  contentHash?: string
  previous?: MediaMetadataRecord | null
  now?: string
}): MediaMetadataRecord {
  const now = args.now ?? new Date().toISOString()
  const write = args.metadata
  const record: MediaMetadataRecord = {
    id: args.id,
    storageType: 'workspace',
    fileName: write.name,
    fileSize: write.fileSize ?? args.file.size,
    mimeType: write.mimeType || args.file.type || 'application/octet-stream',
    extension: args.extension,
    createdAt: args.previous?.createdAt ?? now,
    updatedAt: now,
  }
  assignNumber(record, 'durationMs', write.durationMs)
  assignNumber(record, 'width', write.width)
  assignNumber(record, 'height', write.height)
  assignNumber(record, 'fps', write.fps)
  assignBoolean(record, 'hasVideo', write.hasVideo)
  assignBoolean(record, 'hasAudio', write.hasAudio)
  assignString(record, 'videoCodec', write.videoCodec)
  assignString(record, 'audioCodec', write.audioCodec)
  assignNumber(record, 'sampleRate', write.sampleRate)
  assignNumber(record, 'channelCount', write.channelCount)
  assignBoolean(record, 'videoCodecSupported', write.videoCodecSupported)
  assignBoolean(record, 'audioCodecSupported', write.audioCodecSupported)
  if (args.contentHash) record.contentHash = args.contentHash
  if (write.thumbnail) record.thumbnailId = args.id
  else if (args.previous?.thumbnailId) record.thumbnailId = args.previous.thumbnailId
  return record
}

/** Reads either the expanded record or the old `{ name, mimeType }` file. */
export function parseMediaMetadata(value: unknown, mediaId: string): MediaMetadataRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const fileName = stringField(record, 'fileName') ?? stringField(record, 'name')
  const mimeType = stringField(record, 'mimeType')
  if (!fileName || !mimeType) return null
  const now = new Date().toISOString()
  const parsed: MediaMetadataRecord = {
    id: stringField(record, 'id') ?? mediaId,
    storageType: 'workspace',
    fileName,
    fileSize: numberField(record, 'fileSize') ?? 0,
    mimeType,
    extension: stringField(record, 'extension') ?? '',
    createdAt: stringField(record, 'createdAt') ?? now,
    updatedAt: stringField(record, 'updatedAt') ?? stringField(record, 'createdAt') ?? now,
  }
  const durationMs = numberField(record, 'durationMs')
  const width = numberField(record, 'width')
  const height = numberField(record, 'height')
  const fps = numberField(record, 'fps')
  const sampleRate = numberField(record, 'sampleRate')
  const channelCount = numberField(record, 'channelCount')
  if (durationMs != null) parsed.durationMs = durationMs
  if (width != null) parsed.width = width
  if (height != null) parsed.height = height
  if (fps != null) parsed.fps = fps
  if (typeof record.hasVideo === 'boolean') parsed.hasVideo = record.hasVideo
  if (typeof record.hasAudio === 'boolean') parsed.hasAudio = record.hasAudio
  const videoCodec = stringField(record, 'videoCodec')
  const audioCodec = stringField(record, 'audioCodec')
  const contentHash = stringField(record, 'contentHash')
  const thumbnailId = stringField(record, 'thumbnailId')
  if (videoCodec) parsed.videoCodec = videoCodec
  if (audioCodec) parsed.audioCodec = audioCodec
  if (sampleRate != null) parsed.sampleRate = sampleRate
  if (channelCount != null) parsed.channelCount = channelCount
  if (typeof record.videoCodecSupported === 'boolean') {
    parsed.videoCodecSupported = record.videoCodecSupported
  }
  if (typeof record.audioCodecSupported === 'boolean') {
    parsed.audioCodecSupported = record.audioCodecSupported
  }
  if (contentHash) parsed.contentHash = contentHash
  if (thumbnailId) parsed.thumbnailId = thumbnailId
  return parsed
}

export async function blobsMatch(left: Blob, right: Blob): Promise<boolean> {
  if (left.size !== right.size) return false
  const leftHash = await hashBlobSha256(left)
  const rightHash = await hashBlobSha256(right)
  if (leftHash && rightHash) return leftHash === rightHash
  const [leftBytes, rightBytes] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()])
  const leftView = new Uint8Array(leftBytes)
  const rightView = new Uint8Array(rightBytes)
  if (leftView.length !== rightView.length) return false
  for (let index = 0; index < leftView.length; index += 1) {
    if (leftView[index] !== rightView[index]) return false
  }
  return true
}
export async function hashBlobSha256(blob: Blob): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

function assignNumber(
  record: MediaMetadataRecord,
  key: 'durationMs' | 'width' | 'height' | 'fps' | 'sampleRate' | 'channelCount',
  value: number | undefined,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) record[key] = value
}

function assignBoolean(
  record: MediaMetadataRecord,
  key: 'hasVideo' | 'hasAudio' | 'videoCodecSupported' | 'audioCodecSupported',
  value: boolean | undefined,
): void {
  if (typeof value === 'boolean') record[key] = value
}

function assignString(
  record: MediaMetadataRecord,
  key: 'videoCodec' | 'audioCodec',
  value: string | undefined,
): void {
  if (typeof value === 'string' && value.trim()) record[key] = value
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' && record[key] ? (record[key] as string) : null
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
    ? (record[key] as number)
    : null
}
