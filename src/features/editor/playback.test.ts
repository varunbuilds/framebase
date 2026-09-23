import { describe, expect, it } from 'vitest'
import {
  advanceThroughGap,
  getPlaybackEndMs,
  resolvePlaybackAt,
  resolvePlaybackTrack,
  sourceToTimelineTimeMs,
  timelineToSourceTimeMs,
} from '@/features/editor/playback'
import type { Clip, MediaSource, ProjectDocument, Track } from '@/types/timeline'

function track(
  partial: Pick<Track, 'id' | 'name' | 'kind' | 'order'>,
): Track {
  return { muted: false, locked: false, ...partial }
}

function media(
  partial: Pick<MediaSource, 'id' | 'name' | 'kind' | 'durationMs'>,
): MediaSource {
  return {
    mimeType: partial.kind === 'video' ? 'video/mp4' : 'audio/mpeg',
    availability: 'ready',
    importedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function clip(partial: Clip): Clip {
  return partial
}

function project(parts: {
  tracks: Track[]
  clips: Clip[]
  mediaSources: MediaSource[]
}): ProjectDocument {
  return {
    id: 'project_1',
    name: 'Test',
    tracks: parts.tracks,
    clips: parts.clips,
    mediaSources: parts.mediaSources,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('resolvePlaybackTrack', () => {
  it('prefers the lowest-order video track over audio', () => {
    const doc = project({
      tracks: [
        track({ id: 'a1', name: 'Audio 1', kind: 'audio', order: 0 }),
        track({ id: 'v1', name: 'Video 1', kind: 'video', order: 1 }),
        track({ id: 'v2', name: 'Video 2', kind: 'video', order: 2 }),
      ],
      clips: [],
      mediaSources: [],
    })

    expect(resolvePlaybackTrack(doc)?.id).toBe('v1')
  })
})

describe('timeline ↔ source mapping', () => {
  const sample = clip({
    id: 'c1',
    mediaSourceId: 'm1',
    trackId: 'v1',
    timelineStartMs: 1000,
    sourceInMs: 500,
    sourceOutMs: 2500,
  })

  it('maps timeline time into source time using in-point offset', () => {
    expect(timelineToSourceTimeMs(sample, 1000)).toBe(500)
    expect(timelineToSourceTimeMs(sample, 1500)).toBe(1000)
    expect(timelineToSourceTimeMs(sample, 3000)).toBe(2500)
  })

  it('maps source time back to timeline time', () => {
    expect(sourceToTimelineTimeMs(sample, 500)).toBe(1000)
    expect(sourceToTimelineTimeMs(sample, 1000)).toBe(1500)
  })
})

describe('resolvePlaybackAt', () => {
  const video = track({ id: 'v1', name: 'Video 1', kind: 'video', order: 0 })
  const audio = track({ id: 'a1', name: 'Audio 1', kind: 'audio', order: 1 })
  const sourceA = media({
    id: 'm1',
    name: 'A.mp4',
    kind: 'video',
    durationMs: 10_000,
  })
  const sourceB = media({
    id: 'm2',
    name: 'B.mp4',
    kind: 'video',
    durationMs: 10_000,
  })

  const clipA = clip({
    id: 'c1',
    mediaSourceId: 'm1',
    trackId: 'v1',
    timelineStartMs: 0,
    sourceInMs: 0,
    sourceOutMs: 2000,
  })

  const clipB = clip({
    id: 'c2',
    mediaSourceId: 'm2',
    trackId: 'v1',
    timelineStartMs: 3000,
    sourceInMs: 1000,
    sourceOutMs: 4000,
  })

  const doc = project({
    tracks: [video, audio],
    clips: [clipA, clipB],
    mediaSources: [sourceA, sourceB],
  })

  it('reports empty when the active track has no clips', () => {
    const empty = project({
      tracks: [video, audio],
      clips: [],
      mediaSources: [],
    })
    expect(resolvePlaybackAt(empty, 0).status).toBe('empty')
    expect(getPlaybackEndMs(empty)).toBe(0)
  })

  it('resolves the active clip and source time inside a clip', () => {
    const atStart = resolvePlaybackAt(doc, 0)
    expect(atStart.status).toBe('clip')
    if (atStart.status === 'clip') {
      expect(atStart.clip.id).toBe('c1')
      expect(atStart.sourceTimeMs).toBe(0)
    }

    const midB = resolvePlaybackAt(doc, 3500)
    expect(midB.status).toBe('clip')
    if (midB.status === 'clip') {
      expect(midB.clip.id).toBe('c2')
      expect(midB.sourceTimeMs).toBe(1500)
    }
  })

  it('uses half-open boundaries so the end of a clip is not inside it', () => {
    const atEnd = resolvePlaybackAt(doc, 2000)
    expect(atEnd.status).toBe('gap')
  })

  it('reports gaps between clips', () => {
    const gap = resolvePlaybackAt(doc, 2500)
    expect(gap).toEqual({
      status: 'gap',
      trackId: 'v1',
      timelineTimeMs: 2500,
    })
  })

  it('reports ended at and beyond the playback end', () => {
    expect(getPlaybackEndMs(doc)).toBe(6000)
    expect(resolvePlaybackAt(doc, 6000).status).toBe('ended')
    expect(resolvePlaybackAt(doc, 9000).status).toBe('ended')
    const ended = resolvePlaybackAt(doc, 9000)
    if (ended.status === 'ended') {
      expect(ended.timelineTimeMs).toBe(6000)
    }
  })

  it('ignores clips on non-active tracks', () => {
    const audioClip = clip({
      id: 'ca',
      mediaSourceId: 'm1',
      trackId: 'a1',
      timelineStartMs: 0,
      sourceInMs: 0,
      sourceOutMs: 5000,
    })
    const mixed = project({
      tracks: [video, audio],
      clips: [audioClip],
      mediaSources: [sourceA],
    })
    // Active track is video; audio-only content → empty video timeline.
    expect(getPlaybackEndMs(mixed)).toBe(0)
    expect(resolvePlaybackAt(mixed, 100).status).toBe('empty')
  })

  it('plays consecutive clips without a gap at the shared boundary', () => {
    const consecutive = project({
      tracks: [video],
      mediaSources: [sourceA, sourceB],
      clips: [
        clip({
          id: 'c1',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 0,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: 'c2',
          mediaSourceId: 'm2',
          trackId: 'v1',
          timelineStartMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
      ],
    })

    const atBoundary = resolvePlaybackAt(consecutive, 1000)
    expect(atBoundary.status).toBe('clip')
    if (atBoundary.status === 'clip') {
      expect(atBoundary.clip.id).toBe('c2')
      expect(atBoundary.sourceTimeMs).toBe(0)
    }
  })
})

describe('advanceThroughGap', () => {
  const video = track({ id: 'v1', name: 'Video 1', kind: 'video', order: 0 })
  const source = media({
    id: 'm1',
    name: 'A.mp4',
    kind: 'video',
    durationMs: 5000,
  })
  const doc = project({
    tracks: [video],
    mediaSources: [source],
    clips: [
      clip({
        id: 'c1',
        mediaSourceId: 'm1',
        trackId: 'v1',
        timelineStartMs: 2000,
        sourceInMs: 0,
        sourceOutMs: 1000,
      }),
    ],
  })

  it('advances within a leading gap toward the next clip', () => {
    const step = advanceThroughGap(doc, 500, 200)
    expect(step.timelineTimeMs).toBe(700)
    expect(step.reachedClipOrEnd).toBe(false)
  })

  it('stops advancing once the next clip is reached', () => {
    const step = advanceThroughGap(doc, 1900, 200)
    expect(step.timelineTimeMs).toBe(2100)
    expect(step.reachedClipOrEnd).toBe(true)
  })
})
