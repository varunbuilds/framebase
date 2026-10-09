export class MediaStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaStoreUnavailableError'
  }
}

export type StoredMedia = {
  blob: Blob
  name: string
  mimeType: string
}

/**
 * Facts known at import or download time. Omitted fields are unknown —
 * the workspace record must not invent them.
 */
export type MediaWrite = {
  name: string
  mimeType: string
  fileSize?: number
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
  /** Local derived JPEG. Not stored in the project document. */
  thumbnail?: Blob
}

/** Persistent bytes for one media source. Not part of ProjectDocument. */
export interface MediaByteStore {
  save(mediaSourceId: string, file: Blob, metadata: MediaWrite): Promise<void>
  get(mediaSourceId: string): Promise<StoredMedia | null>
  has(mediaSourceId: string): Promise<boolean>
  delete(mediaSourceId: string): Promise<void>
  list(): Promise<string[]>
}

const MEDIA_ID = /^[A-Za-z0-9_-]+$/

export function assertMediaSourceId(mediaSourceId: string): void {
  if (!MEDIA_ID.test(mediaSourceId)) {
    throw new Error('Invalid media id')
  }
}
