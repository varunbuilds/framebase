/**
 * Runtime filmstrip frames plus an optional OPFS copy.
 * Not part of ProjectDocument. Missing frames are regenerated from source media.
 */
import {
  FILMSTRIP_FRAME_HEIGHT,
  FILMSTRIP_JPEG_QUALITY,
  filmstripCacheKey,
  getDerivedCacheStore,
  putDerivedCache,
  readDerivedCache,
} from './derived-cache'

export { FILMSTRIP_FRAME_HEIGHT, FILMSTRIP_JPEG_QUALITY, filmstripCacheKey }

const frames = new Map<string, string>()
const inflight = new Map<string, Promise<boolean>>()

function memoryKey(mediaSourceId: string, timeMs: number): string {
  return `${mediaSourceId}|${Math.round(timeMs)}`
}

function ownsKey(key: string, mediaSourceId: string): boolean {
  return key.startsWith(`${mediaSourceId}|`)
}

function revokeFrameUrl(url: string): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url)
  }
}

export function hasFilmstripFrame(mediaSourceId: string, timeMs: number): boolean {
  return frames.has(memoryKey(mediaSourceId, timeMs))
}

export function getFilmstripFrame(
  mediaSourceId: string,
  timeMs: number,
): string | undefined {
  return frames.get(memoryKey(mediaSourceId, timeMs))
}

/** Remember a JPEG for this session and try to persist it. Persistence failures are ignored. */
export function storeFilmstripFrame(
  mediaSourceId: string,
  timeMs: number,
  jpeg: Blob,
): void {
  rememberFilmstripFrame(mediaSourceId, timeMs, jpeg)
  void putDerivedCache(mediaSourceId, filmstripCacheKey(timeMs), jpeg)
}

export function rememberFilmstripFrame(
  mediaSourceId: string,
  timeMs: number,
  jpeg: Blob,
): string {
  const url = URL.createObjectURL(jpeg)
  const key = memoryKey(mediaSourceId, timeMs)
  const previous = frames.get(key)
  if (previous && previous !== url) revokeFrameUrl(previous)
  frames.set(key, url)
  return url
}

/**
 * Load one persisted frame into memory. Does not touch source media.
 * Returns false when the cache is missing or unusable so the caller can regenerate.
 */
export function loadFilmstripFrame(
  mediaSourceId: string,
  timeMs: number,
): Promise<boolean> {
  if (hasFilmstripFrame(mediaSourceId, timeMs)) return Promise.resolve(true)
  const key = memoryKey(mediaSourceId, timeMs)
  const pending = inflight.get(key)
  if (pending) return pending

  const promise = readPersistedFilmstrip(mediaSourceId, timeMs).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key)
  })
  inflight.set(key, promise)
  return promise
}

async function readPersistedFilmstrip(
  mediaSourceId: string,
  timeMs: number,
): Promise<boolean> {
  const cacheKey = filmstripCacheKey(timeMs)
  const blob = await readDerivedCache(mediaSourceId, cacheKey)
  if (!blob) return false
  if (!(await isJpeg(blob))) {
    await getDerivedCacheStore().invalidate(mediaSourceId, cacheKey).catch(() => undefined)
    return false
  }
  if (hasFilmstripFrame(mediaSourceId, timeMs)) return true
  rememberFilmstripFrame(mediaSourceId, timeMs, blob)
  return true
}

async function isJpeg(blob: Blob): Promise<boolean> {
  const header = new Uint8Array(await blob.slice(0, 3).arrayBuffer())
  return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
}

/** Drop in-memory frames. Does not delete OPFS copies or source bytes. */
export function clearFilmstripFrames(mediaSourceId?: string): void {
  for (const [key, url] of frames) {
    if (mediaSourceId && !ownsKey(key, mediaSourceId)) continue
    revokeFrameUrl(url)
    frames.delete(key)
  }
  for (const key of inflight.keys()) {
    if (!mediaSourceId || ownsKey(key, mediaSourceId)) inflight.delete(key)
  }
}

export function retainFilmstripFrames(keep: ReadonlySet<string>): void {
  const ids = new Set<string>()
  for (const key of frames.keys()) {
    const mediaSourceId = key.slice(0, key.lastIndexOf('|'))
    if (mediaSourceId) ids.add(mediaSourceId)
  }
  for (const mediaSourceId of ids) {
    if (!keep.has(mediaSourceId)) clearFilmstripFrames(mediaSourceId)
  }
}
