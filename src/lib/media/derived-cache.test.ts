import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import { durableProjectPayload } from '@/features/projects/document'
import type { MediaSource } from '@/types/timeline'
import {
  assertCacheKey,
  createMemoryDerivedCacheStore,
  filmstripCacheKey,
  putDerivedCache,
  readDerivedCache,
  setDerivedCacheStore,
  waveformCacheKey,
} from './derived-cache'
import { deleteStoredMedia } from './delete-stored-media'
import {
  clearFilmstripFrames,
  getFilmstripFrame,
  loadFilmstripFrame,
} from './filmstrip-cache'
import { createMemoryMediaStore } from './memory-media-store'
import { setMediaByteStore } from './opfs-media-store'
import {
  clearWaveformPeaks,
  encodeWaveformPeaks,
  getWaveformPeaks,
  readCachedWaveform,
} from './waveform'

const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], {
  type: 'image/jpeg',
})

function source(id: string): MediaSource {
  return {
    id,
    name: 'clip.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: true,
    durationMs: 1000,
    mimeType: 'video/mp4',
    locator: { kind: 'opfs', key: id },
    availability: 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('derived media cache', () => {
  afterEach(() => {
    setDerivedCacheStore(null)
    setMediaByteStore(null)
    clearFilmstripFrames()
    clearWaveformPeaks()
  })

  it('builds deterministic cache keys and rejects keys that could escape the cache directory', () => {
    expect(filmstripCacheKey(1000)).toBe('filmstrip/v1/h180-q86/1000.jpg')
    expect(filmstripCacheKey(1000.4)).toBe(filmstripCacheKey(1000))
    expect(waveformCacheKey(16_000)).toBe('waveform/v1/peaks-16000.bin')
    expect(filmstripCacheKey(1000)).not.toBe(waveformCacheKey(1000))
    expect(() => assertCacheKey('../source')).toThrow('Invalid cache key')
    expect(() => filmstripCacheKey(-1)).toThrow('Invalid filmstrip time')
  })

  it('keeps a missing or corrupt cache from affecting source bytes', async () => {
    const files = createMemoryMediaStore()
    const cache = createMemoryDerivedCacheStore()
    setMediaByteStore(files)
    setDerivedCacheStore(cache)
    const bytes = new Blob([Uint8Array.from([1, 2, 3])], { type: 'video/mp4' })
    await files.save('media_a', bytes, { name: 'a.mp4', mimeType: 'video/mp4' })

    expect(await readDerivedCache('media_a', filmstripCacheKey(500))).toBeNull()
    expect(await readCachedWaveform('media_a', 4)).toBeNull()
    expect(new Uint8Array(await (await files.get('media_a'))!.blob.arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3]),
    )

    await cache.set(
      'media_a',
      filmstripCacheKey(500),
      new Blob([Uint8Array.from([1, 2, 3, 4])]),
    )
    expect(await loadFilmstripFrame('media_a', 500)).toBe(false)
    expect(await cache.get('media_a', filmstripCacheKey(500))).toBeNull()
    expect(await files.has('media_a')).toBe(true)

    await cache.set(
      'media_a',
      waveformCacheKey(4),
      new Blob([Uint8Array.from([1, 2, 3])]),
    )
    expect(await readCachedWaveform('media_a', 4)).toBeNull()
    expect(await cache.get('media_a', waveformCacheKey(4))).toBeNull()
    expect(await files.has('media_a')).toBe(true)
  })

  it('reuses a persisted waveform without reading source bytes again', async () => {
    const files = createMemoryMediaStore()
    const cache = createMemoryDerivedCacheStore()
    setMediaByteStore(files)
    setDerivedCacheStore(cache)
    await files.save('media_wave', new Blob([Uint8Array.from([9])]), {
      name: 'a.mp4',
      mimeType: 'video/mp4',
    })
    const peaks = Float32Array.from([0.25, 0.5, 0.75, 1])
    await cache.set('media_wave', waveformCacheKey(4), encodeWaveformPeaks(peaks))

    const loaded = await getWaveformPeaks('media_wave', 'blob:should-not-be-read', 4)
    expect(Array.from(loaded)).toEqual([0.25, 0.5, 0.75, 1])

    clearWaveformPeaks('media_wave')
    await cache.invalidate('media_wave', waveformCacheKey(4))
    await expect(getWaveformPeaks('media_wave', 'blob:missing', 4)).rejects.toThrow()
    expect(await files.has('media_wave')).toBe(true)
  })

  it('reloads a filmstrip frame from cache after the in-memory copy is dropped', async () => {
    const cache = createMemoryDerivedCacheStore()
    setDerivedCacheStore(cache)
    const createObjectUrl = URL.createObjectURL
    const revokeObjectUrl = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:frame'
    URL.revokeObjectURL = () => undefined
    try {
      await cache.set('media_a', filmstripCacheKey(500), jpeg)
      clearFilmstripFrames('media_a')
      expect(await loadFilmstripFrame('media_a', 500)).toBe(true)
      expect(getFilmstripFrame('media_a', 500)).toBe('blob:frame')
    } finally {
      URL.createObjectURL = createObjectUrl
      URL.revokeObjectURL = revokeObjectUrl
    }
  })

  it('does not remove source bytes when a cache write fails', async () => {
    const files = createMemoryMediaStore()
    const cache = createMemoryDerivedCacheStore()
    cache.set = async () => {
      throw new Error('quota')
    }
    setMediaByteStore(files)
    setDerivedCacheStore(cache)
    await files.save('media_a', new Blob([Uint8Array.from([1])]), {
      name: 'a.mp4',
      mimeType: 'video/mp4',
    })

    expect(await putDerivedCache('media_a', filmstripCacheKey(100), jpeg)).toBe(false)
    expect(await files.has('media_a')).toBe(true)
  })

  it('deletes one media source cache without deleting another source or its cache', async () => {
    const files = createMemoryMediaStore()
    const cache = createMemoryDerivedCacheStore()
    setMediaByteStore(files)
    setDerivedCacheStore(cache)
    const metadata = { name: 'a.mp4', mimeType: 'video/mp4' }
    await files.save('media_a', new Blob([Uint8Array.from([1])]), metadata)
    await files.save('media_b', new Blob([Uint8Array.from([2])]), metadata)
    await cache.set('media_a', filmstripCacheKey(10), jpeg)
    await cache.set(
      'media_b',
      waveformCacheKey(4),
      encodeWaveformPeaks(Float32Array.from([1, 1, 1, 1])),
    )

    await deleteStoredMedia('media_a')

    expect(await files.has('media_a')).toBe(false)
    expect(await files.has('media_b')).toBe(true)
    expect(await cache.get('media_a', filmstripCacheKey(10))).toBeNull()
    expect(await cache.get('media_b', waveformCacheKey(4))).not.toBeNull()
  })

  it('leaves the cache in place when the source delete fails', async () => {
    const files = createMemoryMediaStore()
    const cache = createMemoryDerivedCacheStore()
    setMediaByteStore(files)
    setDerivedCacheStore(cache)
    await files.save('media_a', new Blob([Uint8Array.from([1])]), {
      name: 'a.mp4',
      mimeType: 'video/mp4',
    })
    await cache.set('media_a', filmstripCacheKey(10), jpeg)
    files.delete = async () => {
      throw new Error('source disk')
    }

    await expect(deleteStoredMedia('media_a')).rejects.toThrow('source disk')
    expect(await files.has('media_a')).toBe(true)
    expect(await cache.get('media_a', filmstripCacheKey(10))).not.toBeNull()
  })

  it('does not write cache bytes into the project document', () => {
    const document = createEmptyProject('Cut', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    document.mediaSources = [source('media_a')]
    const json = JSON.stringify(durableProjectPayload(document))
    expect(json).not.toContain('blob:')
    expect(json).not.toContain('data:image')
    expect(json).not.toContain('filmstrip')
    expect(json).not.toContain('objectUrl')
    expect(json).toContain('"kind":"opfs"')
  })
})
