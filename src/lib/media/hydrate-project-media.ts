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

function hydrationKey(document: ProjectDocument): string {
  const media = document.mediaSources
    .map((source) => {
      const locator =
        source.locator.kind === 'runtime'
          ? 'runtime'
          : `${source.locator.kind}:${source.locator.key}`
      return `${source.id}=${locator}`
    })
    .sort()
    .join(',')
  return `${document.id}|${media}`
}

/** Drop in-flight hydrations. Does not touch OPFS bytes. */
export function clearHydrationCache(): void {
  inflight.clear()
}

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
  const key = hydrationKey(document)
  const existing = inflight.get(key)
  if (existing) return existing
  const promise = hydrateDocumentMedia(document, options).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key)
  })
  inflight.set(key, promise)
  return promise
}

/** Apply a hydration result only for the mount that is still current. */
export function commitHydratedDocument(args: {
  active: boolean
  hydrated: ProjectDocument
  load: (document: ProjectDocument) => void
}): boolean {
  mediaLog('hydrate commit', {
    active: args.active,
    projectId: args.hydrated.id,
    media: args.hydrated.mediaSources.map((source) => ({
      id: source.id,
      locator: source.locator,
      availability: source.availability,
      hasObjectUrl: Boolean(getObjectUrl(source.id)),
    })),
  })
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
      if (source.locator.kind !== 'opfs' && source.locator.kind !== 'local') return source
      return attachOpfsSource(
        document.id,
        source,
        store,
        attach,
        attachedIds,
        options?.onStatus,
      )
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
  projectId: string,
  source: MediaSource,
  store: MediaByteStore,
  attach: (mediaSourceId: string, file: Blob) => void,
  attachedIds: string[],
  onStatus?: (mediaSourceId: string, availability: MediaAvailability) => void,
): Promise<MediaSource> {
  if (source.locator.kind !== 'opfs' && source.locator.kind !== 'local') return source
  onStatus?.(source.id, 'loading')
  try {
    const present = await store.has(source.locator.key)
    // Read the bytes even when has() missed. A false negative must not
    // discard a file that get() can still open.
    const stored = await store.get(source.locator.key)
    let objectUrlCreated = false
    mediaLog('opfs read', {
      projectId,
      mediaSourceId: source.id,
      locator: source.locator,
      hasMedia: present,
      getMedia: Boolean(stored),
      availability: stored ? 'available' : 'missing',
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
    objectUrlCreated = Boolean(getObjectUrl(source.id))
    mediaLog('object url result', {
      projectId,
      mediaSourceId: source.id,
      created: objectUrlCreated,
    })
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
