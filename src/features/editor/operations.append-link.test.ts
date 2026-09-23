import { describe, expect, it } from 'vitest'
import {
  addMediaSource,
  addMediaToTimeline,
  linkClip,
  unlinkClip,
} from '@/features/editor/operations'
import { createEmptyProject, getTrackContentEndMs } from '@/features/editor/project'
import type { MediaSource } from '@/types/timeline'

function avSource(id: string, name: string, durationMs: number): MediaSource {
  return {
    id,
    name,
    kind: 'video',
    hasVideo: true,
    hasAudio: true,
    durationMs,
    mimeType: 'video/mp4',
    availability: 'ready',
    importedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('addMediaToTimeline', () => {
  it('appends after existing clips on the same rows and links AV pairs', () => {
    let document = createEmptyProject('Test')
    const first = avSource('m1', 'one.mp4', 2000)
    const second = avSource('m2', 'two.mp4', 3000)

    let result = addMediaSource(document, first)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    document = result.document

    result = addMediaSource(document, second)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    document = result.document

    const placed = addMediaToTimeline({ document, mediaSourceId: 'm1' })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    document = placed.document
    expect(placed.clipIds?.length).toBe(2)

    const videoTrack = document.tracks.find((track) => track.kind === 'video')!
    const audioTrack = document.tracks.find((track) => track.kind === 'audio')!
    expect(getTrackContentEndMs(document, videoTrack.id)).toBe(2000)
    expect(getTrackContentEndMs(document, audioTrack.id)).toBe(2000)

    const linkedId = document.clips[0]?.linkGroupId
    expect(linkedId).toBeTruthy()
    expect(document.clips.every((clip) => clip.linkGroupId === linkedId)).toBe(
      true,
    )

    const secondPlace = addMediaToTimeline({ document, mediaSourceId: 'm2' })
    expect(secondPlace.ok).toBe(true)
    if (!secondPlace.ok) return
    document = secondPlace.document

    const m2Clips = document.clips.filter((clip) => clip.mediaSourceId === 'm2')
    expect(m2Clips).toHaveLength(2)
    expect(m2Clips.every((clip) => clip.timelineStartMs === 2000)).toBe(true)
    expect(getTrackContentEndMs(document, videoTrack.id)).toBe(5000)
  })

  it('can unlink and re-link AV clips', () => {
    let document = createEmptyProject('Test')
    const source = avSource('m1', 'one.mp4', 1000)
    const added = addMediaSource(document, source)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    document = added.document

    const placed = addMediaToTimeline({ document, mediaSourceId: 'm1' })
    expect(placed.ok).toBe(true)
    if (!placed.ok || !placed.clipId) return
    document = placed.document

    const unlinked = unlinkClip(document, placed.clipId)
    expect(unlinked.ok).toBe(true)
    if (!unlinked.ok) return
    document = unlinked.document
    expect(document.clips.every((clip) => !clip.linkGroupId)).toBe(true)

    const relinked = linkClip(document, placed.clipId)
    expect(relinked.ok).toBe(true)
    if (!relinked.ok) return
    const groupId = relinked.document.clips.find(
      (clip) => clip.id === placed.clipId,
    )?.linkGroupId
    expect(groupId).toBeTruthy()
    expect(
      relinked.document.clips.filter((clip) => clip.linkGroupId === groupId),
    ).toHaveLength(2)
  })
})
