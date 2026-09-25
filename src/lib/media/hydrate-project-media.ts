import type { MediaSource, ProjectDocument } from '@/types/timeline'
import type { MediaByteStore } from './media-byte-store'
import { getMediaByteStore } from './opfs-media-store'
import { getObjectUrl, setObjectUrl } from './object-urls'

export type HydratedProjectMedia = {
  document: ProjectDocument
  attachedIds: string[]
}

/**
 * Rebuilds runtime object URLs from OPFS for locators stored on the document.
 * The document itself still holds only the locator and metadata.
 */
export async function hydrateDocumentMedia(
  document: ProjectDocument,
  options?: {
    store?: MediaByteStore
    hasRuntimeBytes?: (mediaSourceId: string) => boolean
    attach?: (mediaSourceId: string, file: Blob) => void
  },
): Promise<HydratedProjectMedia> {
  const store = options?.store ?? getMediaByteStore()
  const hasRuntimeBytes =
    options?.hasRuntimeBytes ?? ((mediaSourceId: string) => Boolean(getObjectUrl(mediaSourceId)))
  const attach =
    options?.attach ??
    ((mediaSourceId: string, file: Blob) => {
      setObjectUrl(mediaSourceId, URL.createObjectURL(file))
    })
  const attachedIds: string[] = []

  const mediaSources = await Promise.all(
    document.mediaSources.map(async (source) => {
      if (source.locator.kind === 'runtime') {
        return hasRuntimeBytes(source.id)
          ? { ...source, availability: 'available' as const }
          : { ...source, availability: 'missing' as const }
      }
      if (source.locator.kind !== 'opfs') return source
      return attachOpfsSource(source, store, attach, attachedIds)
    }),
  )

  return {
    document: { ...document, mediaSources },
    attachedIds,
  }
}

async function attachOpfsSource(
  source: MediaSource,
  store: MediaByteStore,
  attach: (mediaSourceId: string, file: Blob) => void,
  attachedIds: string[],
): Promise<MediaSource> {
  if (source.locator.kind !== 'opfs') return source
  try {
    const stored = await store.get(source.locator.key)
    if (!stored) return { ...source, availability: 'missing' }
    attach(source.id, stored.blob)
    attachedIds.push(source.id)
    return { ...source, availability: 'available' }
  } catch {
    return { ...source, availability: 'error' }
  }
}
