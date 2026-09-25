import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyOperation } from '@/features/editor/apply-operation'
import { addMediaSource, trimClip } from '@/features/editor/operations'
import type { Clip, MediaSource, ProjectDocument } from '@/types/timeline'

function document(): ProjectDocument {
  return {
    id: 'project_1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tracks: [
      {
        id: 'track_v',
        name: 'Video 1',
        kind: 'video',
        order: 0,
        muted: false,
        locked: false,
      },
    ],
    mediaSources: [media('media_1')],
    clips: [placedClip('clip_1', 0)],
  }
}

function media(id: string): MediaSource {
  return {
    id,
    name: 'clip.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: false,
    durationMs: 5000,
    mimeType: 'video/mp4',
    locator: { kind: 'runtime' },
    availability: 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
  }
}

function placedClip(id: string, timelineStartMs: number): Clip {
  return {
    id,
    mediaSourceId: 'media_1',
    trackId: 'track_v',
    timelineStartMs,
    sourceInMs: 0,
    sourceOutMs: 5000,
    label: 'clip.mp4',
  }
}

describe('applyOperation determinism', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies the same move to equivalent documents with the same result', () => {
    const operation = {
      type: 'clip.move' as const,
      clipId: 'clip_1',
      timelineStartMs: 1250,
      trackId: 'track_v',
    }
    const first = applyOperation(document(), operation)
    const second = applyOperation(structuredClone(document()), operation)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.document).toEqual(second.document)
    expect(first.document.clips[0]?.timelineStartMs).toBe(1250)
    expect(first.document.updatedAt).toBe(document().updatedAt)
  })

  it('applies the same trim without changing updatedAt', () => {
    const source = document()
    const operation = {
      type: 'clip.trim' as const,
      clipId: 'clip_1',
      sourceInMs: 200,
      sourceOutMs: 1800,
      timelineStartMs: 400,
    }
    const randomSpy = vi.spyOn(crypto, 'randomUUID')
    const dateSpy = vi.spyOn(Date.prototype, 'toISOString')

    const first = applyOperation(source, operation)
    const second = applyOperation(structuredClone(source), operation)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.document).toEqual(second.document)
    expect(first.document.clips[0]).toMatchObject({
      sourceInMs: 200,
      sourceOutMs: 1800,
      timelineStartMs: 400,
    })
    expect(first.document.updatedAt).toBe(source.updatedAt)
    expect(randomSpy).not.toHaveBeenCalled()
    expect(dateSpy).not.toHaveBeenCalled()
  })

  it('keeps clip ids that were assigned before add is applied', () => {
    const clip = placedClip('clip_added', 5000)
    const operation = { type: 'clip.add' as const, clip }
    expect(operation.clip.id).toBe('clip_added')

    const randomSpy = vi.spyOn(crypto, 'randomUUID')
    const dateSpy = vi.spyOn(Date.prototype, 'toISOString')
    const result = applyOperation(document(), operation)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.clips.map((item) => item.id)).toEqual([
      'clip_1',
      'clip_added',
    ])
    expect(result.document.updatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(randomSpy).not.toHaveBeenCalled()
    expect(dateSpy).not.toHaveBeenCalled()
  })

  it('does not stamp updatedAt when an existing command applies a trimmed clip', () => {
    const source = document()
    const randomSpy = vi.spyOn(crypto, 'randomUUID')
    const result = trimClip({
      document: source,
      clipId: 'clip_1',
      sourceInMs: 100,
      sourceOutMs: 900,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.updatedAt).toBe(source.updatedAt)
    expect(result.document.clips[0]?.sourceInMs).toBe(100)
    expect(randomSpy).not.toHaveBeenCalled()
  })

  it('registers a media source using the id supplied before apply', () => {
    const source = document()
    const randomSpy = vi.spyOn(crypto, 'randomUUID')
    const dateSpy = vi.spyOn(Date.prototype, 'toISOString')
    const result = addMediaSource(source, media('media_known'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.mediaSources.map((item) => item.id)).toEqual([
      'media_1',
      'media_known',
    ])
    expect(result.document.mediaSources[1]?.importedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    )
    expect(result.document.updatedAt).toBe(source.updatedAt)
    expect(randomSpy).not.toHaveBeenCalled()
    expect(dateSpy).not.toHaveBeenCalled()
  })
})
