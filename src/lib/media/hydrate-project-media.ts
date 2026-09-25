import type { MediaAvailability, MediaSource, ProjectDocument } from '@/types/timeline'
import type { MediaByteStore } from './media-byte-store'
import { getMediaByteStore } from './opfs-media-store'
import { getObjectUrl, setObjectUrl } from './object-urls'

export type HydratedProjectMedia = {
  document: ProjectDocument
  attachedIds: string[]
}

type HydrateOptions = {
  store?: MediaByteStore
  hasRuntimeBytes?: (mediaSourceId: string) => boolean
  attach?: (mediaSourceId: string, file: Blob) => void
  onStatus?: (mediaSourceId: string, availability: MediaAvailability) => void
}

const inflight = new Map<string, Promise<HydratedProjectMedia>>()

function mediaLog(message: string, details?: unknown): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return
  console.info('[framebase-media]', message, details ?? '')
}

/**
 * One OPFS read per project while a hydration is already running.
 * React strict mode mounts the editor effect twice; both calls share this
 * promise so the cancelled mount cannot start a second read or revoke the
 * URL created by the live one.
 */
export function hydrateDocumentMediaOnce(
  document: ProjectDocument,
  options?: HydrateOptions,
): Promise<HydratedProjectMedia> {
  const existing = inflight.get(document.id)
  if (existing) return existing
  const promise = hydrateDocumentMedia(document, options).finally(() => {
    if (inflight.get(document.id) === promise) inflight.delete(document.id)
  })
  inflight.set(document.id, promise)
  return promise
}

/** Apply a hydration result only for the mount that is still current. */
export function commitHydratedDocument(args: {
  active: boolean
  hydrated: ProjectDocument
  load: (document: ProjectDocument) => void
}): boolean {
  if (!args.active) return false
  args.load(args.hydrated)
  return true
}

export async function hydrateDocumentMedia(
  document: ProjectDocument,
  options?: HydrateOptions,
): Promise<HydratedProjectMedia> {
  mediaLog('hydrate start', {
    projectId: document.id,
    media: document.mediaSources.map((source) => ({
      id: source.id,
      locator: source.locator,
      availability: source.availability,
    })),
  })
  const store = options?.store ?? getMediaByteStore()
  const hasRuntimeBytes =
    options?.hasRuntimeBytes ?? ((mediaSourceId: string) => Boolean(getObjectUrl(mediaSourceId)))
  const attach =
    options?.attach ??
    ((mediaSourceId: string, file: Blob) => {
      const url = URL.createObjectURL(file)
      setObjectUrl(mediaSourceId, url)
      mediaLog('object url created', { mediaSourceId, url })
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
      return attachOpfsSource(source, store, attach, attachedIds, options?.onStatus)
    }),
  )

  const hydrated = {
    document: { ...document, mediaSources },
    attachedIds,
  }
  mediaLog('hydrate end', {
    projectId: document.id,
    media: hydrated.document.mediaSources.map((source) => ({
      id: source.id,
      locator: source.locator,
      availability: source.availability,
      hasObjectUrl: Boolean(getObjectUrl(source.id)),
    })),
  })
  return hydrated
}

async function attachOpfsSource(
  source: MediaSource,
  store: MediaByteStore,
  attach: (mediaSourceId: string, file: Blob) => void,
  attachedIds: string[],
  onStatus?: (mediaSourceId: string, availability: MediaAvailability) => void,
): Promise<MediaSource> {
  if (source.locator.kind !== 'opfs') return source
  onStatus?.(source.id, 'loading')
  try {
    const present = await store.has(source.locator.key)
    const stored = present ? await store.get(source.locator.key) : null
    mediaLog('opfs read', {
      mediaSourceId: source.id,
      key: source.locator.key,
      hasMedia: present,
      gotBytes: Boolean(stored),
    })
    if (!stored) {
      if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
        const directories = await store.list().catch(() => [])
        mediaLog('opfs miss', { key: source.locator.key, directories })
      }
      onStatus?.(source.id, 'missing')
      return { ...source, availability: 'missing' }
    }
    attach(source.id, stored.blob)
    attachedIds.push(source.id)
    onStatus?.(source.id, 'available')
    return { ...source, availability: 'available' }
  } catch (error) {
    mediaLog('opfs error', {
      mediaSourceId: source.id,
      key: source.locator.key,
      error: error instanceof Error ? error.message : 'unknown',
    })
    onStatus?.(source.id, 'error')
    return { ...source, availability: 'error' }
  }
}
