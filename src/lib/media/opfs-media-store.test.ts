import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import type { MediaSource } from '@/types/timeline'
import { hydrateDocumentMedia } from './hydrate-project-media'
import { createMemoryMediaStore } from './memory-media-store'

function opfsSource(id: string, name: string): MediaSource {
  return {
    id,
    name,
    kind: 'video',
    hasVideo: true,
    hasAudio: false,
    durationMs: 1000,
    mimeType: 'video/mp4',
    locator: { kind: 'opfs', key: id },
    availability: 'known',
    importedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('media byte store', () => {
  it('saves, reads, checks, and deletes media by stable id', async () => {
    const store = createMemoryMediaStore()
    const first = new Blob([Uint8Array.from([1, 2, 3])], { type: 'video/mp4' })
    const second = new Blob([Uint8Array.from([9])], { type: 'video/mp4' })

    await store.save('media_a', first, { name: 'video.mp4', mimeType: 'video/mp4' })
    await store.save('media_b', second, { name: 'video.mp4', mimeType: 'video/mp4' })

    expect(await store.has('media_a')).toBe(true)
    expect(await store.has('media_missing')).toBe(false)
    expect(await store.get('media_missing')).toBeNull()

    const stored = await store.get('media_a')
    expect(stored?.name).toBe('video.mp4')
    expect(stored?.mimeType).toBe('video/mp4')
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3]),
    )
    expect(await store.list()).toEqual(expect.arrayContaining(['media_a', 'media_b']))

    await store.delete('media_a')
    expect(await store.has('media_a')).toBe(false)
    expect(await store.has('media_b')).toBe(true)
  })

  it('hydrates an existing OPFS source and leaves missing files unavailable', async () => {
    const store = createMemoryMediaStore()
    const bytes = new Blob([Uint8Array.from([4, 5])], { type: 'video/mp4' })
    await store.save('media_present', bytes, {
      name: 'clip.mp4',
      mimeType: 'video/mp4',
    })

    const document = createEmptyProject(
      'Cut',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    )
    document.mediaSources = [
      opfsSource('media_present', 'clip.mp4'),
      opfsSource('media_gone', 'missing.mp4'),
    ]

    const attached: string[] = []
    const hydrated = await hydrateDocumentMedia(document, {
      store,
      attach: (mediaSourceId, file) => {
        attached.push(mediaSourceId)
        expect(file.size).toBe(2)
      },
    })

    expect(attached).toEqual(['media_present'])
    expect(hydrated.document.mediaSources[0]?.availability).toBe('available')
    expect(hydrated.document.mediaSources[1]?.availability).toBe('missing')
    expect(hydrated.document.mediaSources[0]?.locator).toEqual({
      kind: 'opfs',
      key: 'media_present',
    })
    const json = JSON.stringify(hydrated.document)
    expect(json).not.toContain('blob:')
    expect(json).not.toContain('objectUrl')
  })

  it('marks a failed read as an error and does not attach bytes', async () => {
    const store = createMemoryMediaStore()
    store.get = async () => {
      throw new Error('unreadable')
    }
    const document = createEmptyProject(
      'Cut',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    )
    document.mediaSources = [opfsSource('media_bad', 'bad.mp4')]
    const hydrated = await hydrateDocumentMedia(document, {
      store,
      attach: () => {
        throw new Error('should not attach')
      },
    })
    expect(hydrated.document.mediaSources[0]?.availability).toBe('error')
    expect(hydrated.attachedIds).toEqual([])
  })
})
