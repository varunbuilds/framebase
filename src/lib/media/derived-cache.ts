import { createResolvingCacheStore } from '@/lib/workspace/resolving-store'
import { boundWorkspaceCache } from '@/lib/workspace/store-binding'
import { assertMediaSourceId } from './media-byte-store'
import { isPersistentMediaAvailable } from './opfs-media-store'

/**
 * Rebuildable artifacts for one immutable import.
 * Source bytes stay in `framebase-media`. These files stay in `framebase-cache`.
 * A missing or broken cache is never a reason to mark source media unavailable.
 *
 * An imported source is immutable. A new import is a new mediaSourceId, so the
 * cache identity does not need a content hash. Bump the version inside the key
 * when the generator changes.
 */
export interface DerivedCacheStore {
  get(mediaSourceId: string, cacheKey: string): Promise<Blob | null>
  set(mediaSourceId: string, cacheKey: string, blob: Blob): Promise<void>
  invalidate(mediaSourceId: string, cacheKey: string): Promise<void>
  deleteMedia(mediaSourceId: string): Promise<void>
  clearAll(): Promise<void>
}

const CACHE_SEGMENT = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/

export function assertCacheKey(cacheKey: string): void {
  const segments = cacheKey.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '..' || !CACHE_SEGMENT.test(segment))
  ) {
    throw new Error('Invalid cache key')
  }
}

export const FILMSTRIP_VERSION = 1
export const FILMSTRIP_FRAME_HEIGHT = 180
export const FILMSTRIP_JPEG_QUALITY = 0.86
const FILMSTRIP_JPEG_QUALITY_PERCENT = 86

export const WAVEFORM_VERSION = 1

/** Filmstrip tile at a source time. Height and JPEG quality are part of the key. */
export function filmstripCacheKey(timeMs: number): string {
  const time = Math.round(timeMs)
  if (!Number.isFinite(time) || time < 0) throw new Error('Invalid filmstrip time')
  return `filmstrip/v${FILMSTRIP_VERSION}/h${FILMSTRIP_FRAME_HEIGHT}-q${FILMSTRIP_JPEG_QUALITY_PERCENT}/${time}.jpg`
}

/** Full-file peak envelope at one resolution. */
export function waveformCacheKey(peakCount: number): string {
  if (!Number.isInteger(peakCount) || peakCount <= 0) {
    throw new Error('Invalid waveform resolution')
  }
  return `waveform/v${WAVEFORM_VERSION}/peaks-${peakCount}.bin`
}

export function createMemoryDerivedCacheStore(): DerivedCacheStore {
  const entries = new Map<string, Blob>()
  const storageKey = (mediaSourceId: string, cacheKey: string) =>
    `${mediaSourceId}/${cacheKey}`

  return {
    async get(mediaSourceId, cacheKey) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      return entries.get(storageKey(mediaSourceId, cacheKey)) ?? null
    },
    async set(mediaSourceId, cacheKey, blob) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      entries.set(storageKey(mediaSourceId, cacheKey), blob)
    },
    async invalidate(mediaSourceId, cacheKey) {
      assertMediaSourceId(mediaSourceId)
      assertCacheKey(cacheKey)
      entries.delete(storageKey(mediaSourceId, cacheKey))
    },
    async deleteMedia(mediaSourceId) {
      assertMediaSourceId(mediaSourceId)
      const prefix = `${mediaSourceId}/`
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key)
      }
    },
    async clearAll() {
      entries.clear()
    },
  }
}

let activeStore: DerivedCacheStore | null = null

export function getDerivedCacheStore(): DerivedCacheStore {
  if (!activeStore) {
    activeStore = isPersistentMediaAvailable()
      ? createResolvingCacheStore({
          workspace: boundWorkspaceCache,
          legacy: createOpfsDerivedCacheStore(),
        })
      : createMemoryDerivedCacheStore()
  }
  return activeStore
}

/** Tests inject a memory store. The app uses OPFS when the browser has it. */
export function setDerivedCacheStore(store: DerivedCacheStore | null): void {
  activeStore = store
}

/**
 * Cache writes are optional. Quota and IO failures return false and leave
 * source media untouched.
 */
export async function putDerivedCache(
  mediaSourceId: string,
  cacheKey: string,
  blob: Blob,
): Promise<boolean> {
  try {
    await getDerivedCacheStore().set(mediaSourceId, cacheKey, blob)
    return true
  } catch {
    return false
  }
}

/** A missing or unreadable cache is a miss, not a media failure. */
export async function readDerivedCache(
  mediaSourceId: string,
  cacheKey: string,
): Promise<Blob | null> {
  try {
    const blob = await getDerivedCacheStore().get(mediaSourceId, cacheKey)
    if (!blob || blob.size === 0) {
      if (blob) {
        await getDerivedCacheStore().invalidate(mediaSourceId, cacheKey).catch(() => undefined)
      }
      return null
    }
    return blob
  } catch {
    await getDerivedCacheStore().invalidate(mediaSourceId, cacheKey).catch(() => undefined)
    return null
  }
}

function createOpfsDerivedCacheStore(): DerivedCacheStore {
  // Imported lazily so tests that only use the memory store do not pull OPFS.
  return createLazyOpfsStore()
}

function createLazyOpfsStore(): DerivedCacheStore {
  let created: Promise<DerivedCacheStore> | null = null
  const load = () => {
    created ??= import('./opfs-derived-cache').then((module) =>
      module.createOpfsDerivedCacheStore(),
    )
    return created
  }
  return {
    get: async (mediaSourceId, cacheKey) => (await load()).get(mediaSourceId, cacheKey),
    set: async (mediaSourceId, cacheKey, blob) =>
      (await load()).set(mediaSourceId, cacheKey, blob),
    invalidate: async (mediaSourceId, cacheKey) =>
      (await load()).invalidate(mediaSourceId, cacheKey),
    deleteMedia: async (mediaSourceId) => (await load()).deleteMedia(mediaSourceId),
    clearAll: async () => (await load()).clearAll(),
  }
}
