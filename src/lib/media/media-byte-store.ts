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

export type MediaWrite = {
  name: string
  mimeType: string
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
