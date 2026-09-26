import { LiveMap, LiveObject, type LsonObject } from '@liveblocks/client'
import { describe, expect, it } from 'vitest'
import { applyOperation } from '@/features/editor/apply-operation'
import { createEmptyProject } from '@/features/editor/project'
import type { Clip, MediaSource, ProjectDocument, Track } from '@/types/timeline'
import {
  collabDocumentEqual,
  createCollabStorage,
  readCollabDocument,
  writeCollabDocument,
  type CollabRoot,
} from './collab-document'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function mediaSource(overrides: Partial<MediaSource> = {}): MediaSource {
  return {
    id: 'media_1',
    name: 'take-1.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: true,
    durationMs: 12_000,
    mimeType: 'video/mp4',
    width: 1920,
    height: 1080,
    sampleRate: 48_000,
    channelCount: 2,
    locator: { kind: 'local', key: 'media_1' },
    availability: 'known',
    importedAt: '2026-01-01T00:00:00.000Z',
    remote: {
      assetId: 'media_1',
      storagePath: 'media/media_1/source',
      sizeBytes: 2048,
      uploadedAt: '2026-01-02T00:00:00.000Z',
    },
    ...overrides,
  }
}

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    mediaSourceId: 'media_1',
    trackId: 'track_video',
    timelineStartMs: 0,
    sourceInMs: 0,
    sourceOutMs: 4_000,
    ...overrides,
  }
}

function tracks(): Track[] {
  return [
    { id: 'track_video', name: 'Video 1', kind: 'video', order: 0, muted: false, locked: false },
    { id: 'track_audio', name: 'Audio 1', kind: 'audio', order: 1, muted: false, locked: false },
  ]
}

/** A populated document: two tracks, one AV source, a linked video/audio pair. */
function document(): ProjectDocument {
  const base = createEmptyProject('Launch cut', PROJECT_ID, '9:16')
  return {
    ...base,
    tracks: tracks(),
    mediaSources: [mediaSource()],
    clips: [
      clip({ id: 'clip_a', linkGroupId: 'link_1', label: 'take-1.mp4' }),
      clip({
        id: 'clip_b',
        trackId: 'track_audio',
        linkGroupId: 'link_1',
        label: 'take-1.mp4',
      }),
      clip({ id: 'clip_c', timelineStartMs: 6_000, sourceInMs: 500, sourceOutMs: 3_500 }),
    ],
  }
}

function root(source: ProjectDocument): CollabRoot {
  return new LiveObject(createCollabStorage(source)) as CollabRoot
}

describe('collaborative document mapping', () => {
  it('round-trips a ProjectDocument through Liveblocks storage', () => {
    const original = document()
    const restored = readCollabDocument(root(original))

    expect(restored.id).toBe(original.id)
    expect(restored.name).toBe('Launch cut')
    expect(restored.canvas).toEqual({ aspectRatio: '9:16' })
    expect(restored.createdAt).toBe(original.createdAt)
    expect(restored.updatedAt).toBe(original.updatedAt)
    expect(restored.tracks).toEqual(original.tracks)
    expect(restored.mediaSources).toEqual(original.mediaSources)
    expect(new Set(restored.clips)).toEqual(new Set(original.clips))
    expect(collabDocumentEqual(restored, original)).toBe(true)
  })

  it('keeps stable ids for every entity across the conversion', () => {
    const original = document()
    const restored = readCollabDocument(root(original))

    expect(restored.tracks.map((track) => track.id)).toEqual([
      'track_video',
      'track_audio',
    ])
    expect(restored.mediaSources.map((source) => source.id)).toEqual(['media_1'])
    expect(restored.clips.map((item) => item.id).sort()).toEqual([
      'clip_a',
      'clip_b',
      'clip_c',
    ])
    expect(
      restored.clips.filter((item) => item.linkGroupId === 'link_1').map((item) => item.id),
    ).toEqual(['clip_a', 'clip_b'])
  })

  it('keeps media bytes out of storage and availability out of the room', () => {
    const storage = createCollabStorage(document())
    const stored = storage.mediaSources.get('media_1')
    expect(stored?.get('remote')).toEqual({
      assetId: 'media_1',
      storagePath: 'media/media_1/source',
      sizeBytes: 2048,
      uploadedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(JSON.stringify(stored?.toJSON())).not.toContain('availability')
  })

  it('carries this device’s media availability forward on a room read', () => {
    const local: ProjectDocument = {
      ...document(),
      mediaSources: [mediaSource({ availability: 'available' })],
    }
    const restored = readCollabDocument(root(local), {
      availability: new Map([['media_1', 'available' as const]]),
    })
    expect(restored.mediaSources[0]?.availability).toBe('available')

    const fresh = readCollabDocument(root(local))
    expect(fresh.mediaSources[0]?.availability).toBe('known')
  })

  it('applies clip.move as a field update on the clip that moved', () => {
    const original = document()
    const storageRoot = root(original)
    const movedClipBefore = storageRoot.get('clips').get('clip_a')
    const otherClipBefore = storageRoot.get('clips').get('clip_c')

    const applied = applyOperation(original, {
      type: 'clip.move',
      clipId: 'clip_a',
      trackId: 'track_video',
      timelineStartMs: 2_500,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return

    writeCollabDocument(storageRoot, original, applied.document)

    // The same LiveObject was patched, so a concurrent edit to another field of
    // this clip — or to any other clip — survives.
    expect(storageRoot.get('clips').get('clip_a')).toBe(movedClipBefore)
    expect(storageRoot.get('clips').get('clip_c')).toBe(otherClipBefore)
    expect(movedClipBefore?.get('timelineStartMs')).toBe(2_500)
    expect(movedClipBefore?.get('trackId')).toBe('track_video')
    expect(otherClipBefore?.get('timelineStartMs')).toBe(6_000)

    const restored = readCollabDocument(storageRoot)
    expect(collabDocumentEqual(restored, applied.document)).toBe(true)
  })

  it('stays deterministic when the same clip.move replays through storage', () => {
    const original = document()
    const move = {
      type: 'clip.move' as const,
      clipId: 'clip_c',
      trackId: 'track_video',
      timelineStartMs: 1_234,
    }

    const direct = applyOperation(original, move)
    const viaStorage = applyOperation(readCollabDocument(root(original)), move)
    expect(direct.ok && viaStorage.ok).toBe(true)
    if (!direct.ok || !viaStorage.ok) return

    const first = root(original)
    writeCollabDocument(first, original, direct.document)
    const second = root(original)
    writeCollabDocument(second, original, direct.document)

    expect(readCollabDocument(first)).toEqual(readCollabDocument(second))
    expect(collabDocumentEqual(readCollabDocument(first), viaStorage.document)).toBe(true)
  })

  it('writes nothing when the document did not change', () => {
    const original = document()
    const storageRoot = root(original)
    const before = storageRoot.get('clips').get('clip_a')?.toJSON()

    writeCollabDocument(storageRoot, original, original)

    expect(storageRoot.get('clips').get('clip_a')?.toJSON()).toEqual(before)
    expect([...storageRoot.get('clips').keys()].length).toBe(3)
  })

  it('clears an optional field that the new document no longer has', () => {
    const original = document()
    const storageRoot = root(original)
    const unlinked = applyOperation(original, {
      type: 'clip.unlink',
      clipIds: ['clip_a'],
    })
    expect(unlinked.ok).toBe(true)
    if (!unlinked.ok) return

    writeCollabDocument(storageRoot, original, unlinked.document)

    expect(storageRoot.get('clips').get('clip_a')?.get('linkGroupId')).toBeUndefined()
    const restored = readCollabDocument(storageRoot)
    expect(restored.clips.every((item) => item.linkGroupId == null)).toBe(true)
  })

  it('deletes only the entities the previous document listed', () => {
    const original = document()
    const storageRoot = root(original)

    // A clip another client inserted, which this client has not observed yet.
    storageRoot.get('clips').set(
      'clip_remote',
      new LiveObject({
        id: 'clip_remote',
        mediaSourceId: 'media_1',
        trackId: 'track_video',
        timelineStartMs: 20_000,
        sourceInMs: 0,
        sourceOutMs: 1_000,
      }),
    )

    const deleted = applyOperation(original, { type: 'clip.delete', clipId: 'clip_c' })
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    writeCollabDocument(storageRoot, original, deleted.document)

    expect(storageRoot.get('clips').has('clip_c')).toBe(false)
    expect(storageRoot.get('clips').has('clip_remote')).toBe(true)
  })

  it('removes a track only after the clips that referenced it', () => {
    const original = document()
    const storageRoot = root(original)
    const next: ProjectDocument = {
      ...original,
      clips: original.clips.filter((item) => item.trackId !== 'track_audio'),
      tracks: original.tracks.filter((track) => track.id !== 'track_audio'),
    }

    writeCollabDocument(storageRoot, original, next)

    expect(storageRoot.get('tracks').has('track_audio')).toBe(false)
    const restored = readCollabDocument(storageRoot)
    const trackIds = new Set(restored.tracks.map((track) => track.id))
    expect(restored.clips.every((item) => trackIds.has(item.trackId))).toBe(true)
  })

  it('applies the remaining editor operations through the same storage write', () => {
    const original = document()
    const storageRoot = root(original)
    let previous = original

    const apply = (operation: Parameters<typeof applyOperation>[1]) => {
      const applied = applyOperation(previous, operation)
      expect(applied.ok).toBe(true)
      if (!applied.ok) return previous
      writeCollabDocument(storageRoot, previous, applied.document)
      previous = applied.document
      return previous
    }

    apply({
      type: 'clip.trim',
      clipId: 'clip_c',
      sourceInMs: 600,
      sourceOutMs: 3_200,
      timelineStartMs: 6_200,
    })
    apply({ type: 'project.rename', name: 'Launch cut v2' })
    apply({
      type: 'media.add',
      source: {
        id: 'media_2',
        name: 'vo.wav',
        kind: 'audio',
        hasVideo: false,
        hasAudio: true,
        durationMs: 8_000,
        mimeType: 'audio/wav',
        locator: { kind: 'local', key: 'media_2' },
        availability: 'known',
        importedAt: '2026-01-03T00:00:00.000Z',
      },
    })
    apply({
      type: 'clip.add',
      clip: clip({
        id: 'clip_d',
        mediaSourceId: 'media_2',
        trackId: 'track_audio',
        timelineStartMs: 12_000,
        sourceOutMs: 2_000,
      }),
    })
    apply({
      type: 'clip.relabel',
      clipId: 'clip_d',
      label: 'VO',
    })
    apply({
      type: 'clip.split',
      cuts: [
        {
          clipId: 'clip_d',
          sourceOutMs: 1_000,
          right: clip({
            id: 'clip_e',
            mediaSourceId: 'media_2',
            trackId: 'track_audio',
            timelineStartMs: 13_000,
            sourceInMs: 1_000,
            sourceOutMs: 2_000,
            label: 'VO',
          }),
        },
      ],
    })
    apply({ type: 'clip.delete', clipId: 'clip_e' })

    const restored = readCollabDocument(storageRoot)
    expect(collabDocumentEqual(restored, previous)).toBe(true)
    expect(restored.name).toBe('Launch cut v2')
    expect(restored.mediaSources.map((source) => source.id)).toEqual([
      'media_1',
      'media_2',
    ])
    expect(restored.clips.find((item) => item.id === 'clip_c')).toMatchObject({
      sourceInMs: 600,
      sourceOutMs: 3_200,
      timelineStartMs: 6_200,
    })
    expect(restored.clips.find((item) => item.id === 'clip_d')).toMatchObject({
      sourceOutMs: 1_000,
      label: 'VO',
    })
    expect(restored.clips.map((item) => item.id)).not.toContain('clip_e')
  })
})

describe('malformed collaborative state', () => {
  it('reads an empty room into the fallback project identity', () => {
    const fallback = createEmptyProject('Seed', PROJECT_ID)
    const empty = new LiveObject({}) as unknown as CollabRoot
    const restored = readCollabDocument(empty, { fallback })

    expect(restored.id).toBe(PROJECT_ID)
    expect(restored.name).toBe('Seed')
    expect(restored.canvas.aspectRatio).toBe('16:9')
    expect(restored.tracks).toEqual([])
    expect(restored.clips).toEqual([])
    expect(restored.mediaSources).toEqual([])
  })

  it('drops clips that reference a missing track or media source', () => {
    const storageRoot = root(document())
    storageRoot.get('tracks').delete('track_audio')
    storageRoot.get('clips').set(
      'clip_orphan',
      new LiveObject({
        id: 'clip_orphan',
        mediaSourceId: 'media_gone',
        trackId: 'track_video',
        timelineStartMs: 0,
        sourceInMs: 0,
        sourceOutMs: 1_000,
      }),
    )

    const restored = readCollabDocument(storageRoot)
    const ids = restored.clips.map((item) => item.id)
    expect(ids).not.toContain('clip_b')
    expect(ids).not.toContain('clip_orphan')
    expect(ids).toEqual(['clip_a', 'clip_c'])
  })

  it('survives wrong types, bad numbers and a hostile shape', () => {
    const hostile = new LiveObject({
      project: 'not an object',
      tracks: new LiveMap<string, LiveObject<LsonObject>>([
        ['track_bad', new LiveObject({ id: 'track_bad', kind: 'subtitle' })],
        [
          'track_ok',
          new LiveObject({
            id: 'track_ok',
            name: 42,
            kind: 'video',
            order: Number.NaN,
            muted: 'yes',
            locked: null,
          }),
        ],
      ]),
      clips: new LiveMap<string, LiveObject<LsonObject>>([
        [
          'clip_backwards',
          new LiveObject({
            id: 'clip_backwards',
            mediaSourceId: 'media_ok',
            trackId: 'track_ok',
            timelineStartMs: 0,
            sourceInMs: 900,
            sourceOutMs: 100,
          }),
        ],
        [
          'clip_infinite',
          new LiveObject({
            id: 'clip_infinite',
            mediaSourceId: 'media_ok',
            trackId: 'track_ok',
            timelineStartMs: Number.POSITIVE_INFINITY,
            sourceInMs: 0,
            sourceOutMs: 1_000,
          }),
        ],
        [
          'clip_ok',
          new LiveObject({
            id: 'clip_ok',
            mediaSourceId: 'media_ok',
            trackId: 'track_ok',
            timelineStartMs: 10.6,
            sourceInMs: 0,
            sourceOutMs: 1_000.4,
            label: 7,
          }),
        ],
      ]),
      mediaSources: new LiveMap<string, LiveObject<LsonObject>>([
        ['media_nan', new LiveObject({ id: 'media_nan', kind: 'video', durationMs: 'long' })],
        [
          'media_ok',
          new LiveObject({
            id: 'media_ok',
            kind: 'video',
            durationMs: 5_000,
            locator: { kind: 'local', key: 'media_ok' },
            remote: { assetId: 'someone_else', storagePath: '../../etc/passwd', sizeBytes: -1 },
          }),
        ],
      ]),
    }) as unknown as CollabRoot

    const fallback = createEmptyProject('Fallback', PROJECT_ID)
    const restored = readCollabDocument(hostile, { fallback })

    expect(restored.id).toBe(PROJECT_ID)
    expect(restored.tracks.map((track) => track.id)).toEqual(['track_ok'])
    expect(restored.tracks[0]).toMatchObject({ name: 'Video', muted: false, locked: false })
    expect(Number.isFinite(restored.tracks[0]?.order)).toBe(true)
    expect(restored.mediaSources.map((source) => source.id)).toEqual(['media_ok'])
    // A remote reference that does not match its own source is not trusted.
    expect(restored.mediaSources[0]?.remote).toBeUndefined()
    expect(restored.clips.map((item) => item.id)).toEqual(['clip_ok'])
    // Canonical timeline time stays integer milliseconds.
    expect(restored.clips[0]?.timelineStartMs).toBe(11)
    expect(restored.clips[0]?.sourceOutMs).toBe(1_000)
    expect(restored.clips[0]?.label).toBeUndefined()
  })

  it('does not throw when storage holds no Live structures at all', () => {
    const garbage = new LiveObject({
      project: 1,
      tracks: 'nope',
      clips: null,
      mediaSources: [1, 2, 3],
    }) as unknown as CollabRoot

    expect(() => readCollabDocument(garbage)).not.toThrow()
    expect(() =>
      writeCollabDocument(garbage, createEmptyProject('a', PROJECT_ID), document()),
    ).not.toThrow()
  })
})
