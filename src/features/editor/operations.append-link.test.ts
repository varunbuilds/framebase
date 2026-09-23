import { describe, expect, it } from 'vitest'
import {
  addMediaSource,
  addMediaToTimeline,
  canLinkClipSelection,
  canUnlinkClipSelection,
  linkClips,
  unlinkClip,
  unlinkClips,
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
})

describe('selection link / unlink', () => {
  it('links any selected video with any selected audio', () => {
    let document = createEmptyProject('Test')
    for (const source of [
      avSource('m1', 'one.mp4', 1000),
      avSource('m2', 'two.mp4', 1000),
    ]) {
      const added = addMediaSource(document, source)
      expect(added.ok).toBe(true)
      if (!added.ok) return
      document = added.document
    }

    const first = addMediaToTimeline({ document, mediaSourceId: 'm1' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    document = first.document

    const second = addMediaToTimeline({ document, mediaSourceId: 'm2' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    document = second.document

    // Break import-time links.
    for (const clip of [...document.clips]) {
      const unlinked = unlinkClip(document, clip.id)
      expect(unlinked.ok).toBe(true)
      if (!unlinked.ok) return
      document = unlinked.document
    }

    const video1 = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm1' &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'video',
    )!
    const audio2 = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'audio',
    )!

    expect(canLinkClipSelection(document, [video1.id, audio2.id])).toBe(true)
    expect(canUnlinkClipSelection(document, [video1.id, audio2.id])).toBe(false)

    const linked = linkClips(document, [video1.id, audio2.id])
    expect(linked.ok).toBe(true)
    if (!linked.ok) return
    document = linked.document

    const groupId = document.clips.find((clip) => clip.id === video1.id)
      ?.linkGroupId
    expect(groupId).toBeTruthy()
    expect(
      document.clips.find((clip) => clip.id === audio2.id)?.linkGroupId,
    ).toBe(groupId)
    expect(canUnlinkClipSelection(document, [video1.id])).toBe(true)
    expect(canLinkClipSelection(document, [video1.id, audio2.id])).toBe(false)

    const unlinked = unlinkClips(document, [video1.id])
    expect(unlinked.ok).toBe(true)
    if (!unlinked.ok) return
    expect(
      unlinked.document.clips.every((clip) => !clip.linkGroupId),
    ).toBe(true)
  })
})
