import { describe, expect, it } from 'vitest'
import {
  addMediaSource,
  addMediaToTimeline,
  canLinkClipSelection,
  canUnlinkClipSelection,
  linkClips,
  planMediaDrop,
  splitClipAtTime,
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

  it('drops onto the pointer lane at that time, and opens a lane when it overlaps', () => {
    let document = createEmptyProject('Test')
    const result = addMediaSource(document, avSource('m1', 'one.mp4', 4000))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    document = result.document
    const second = addMediaSource(document, avSource('m2', 'two.mp4', 2000))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    document = second.document

    const videoTrack = document.tracks.find((track) => track.kind === 'video')!
    const first = addMediaToTimeline({ document, mediaSourceId: 'm1' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    document = first.document

    const plan = planMediaDrop({
      document,
      mediaSourceId: 'm2',
      timelineStartMs: 500,
      trackId: videoTrack.id,
    })
    expect('error' in plan).toBe(false)
    if ('error' in plan) return
    const videoPlacement = plan.placements.find((item) => item.role === 'video')
    expect(videoPlacement?.timelineStartMs).toBe(500)
    expect(videoPlacement?.trackId).not.toBe(videoTrack.id)
    expect(plan.tracks.filter((track) => track.kind === 'video')).toHaveLength(2)

    const dropped = addMediaToTimeline({
      document,
      mediaSourceId: 'm2',
      timelineStartMs: 500,
      trackId: videoTrack.id,
    })
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    const placedVideo = dropped.document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        dropped.document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'video',
    )
    const placedAudio = dropped.document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        dropped.document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'audio',
    )
    expect(placedVideo?.timelineStartMs).toBe(500)
    expect(placedAudio?.timelineStartMs).toBe(500)
    expect(placedVideo?.linkGroupId).toBeTruthy()
    expect(placedVideo?.linkGroupId).toBe(placedAudio?.linkGroupId)
  })
})

describe('splitClipAtTime', () => {
  it('splits a linked pair at the blade time and keeps each side linked', () => {
    let document = createEmptyProject('Test')
    const result = addMediaSource(document, avSource('m1', 'one.mp4', 2000))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    document = result.document

    const placed = addMediaToTimeline({ document, mediaSourceId: 'm1' })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    document = placed.document

    const video = document.clips.find((clip) => {
      const track = document.tracks.find((item) => item.id === clip.trackId)
      return track?.kind === 'video'
    })
    expect(video).toBeTruthy()
    if (!video) return

    const split = splitClipAtTime(document, video.id, 1000)
    expect(split.ok).toBe(true)
    if (!split.ok) return
    document = split.document

    expect(document.clips).toHaveLength(4)
    const videos = document.clips.filter((clip) => {
      const track = document.tracks.find((item) => item.id === clip.trackId)
      return track?.kind === 'video'
    })
    const audios = document.clips.filter((clip) => {
      const track = document.tracks.find((item) => item.id === clip.trackId)
      return track?.kind === 'audio'
    })
    expect(videos.map((clip) => clip.timelineStartMs).sort((a, b) => a - b)).toEqual([
      0, 1000,
    ])
    expect(audios.map((clip) => clip.timelineStartMs).sort((a, b) => a - b)).toEqual([
      0, 1000,
    ])

    const leftVideo = videos.find((clip) => clip.timelineStartMs === 0)
    const rightVideo = videos.find((clip) => clip.timelineStartMs === 1000)
    const leftAudio = audios.find((clip) => clip.timelineStartMs === 0)
    const rightAudio = audios.find((clip) => clip.timelineStartMs === 1000)
    expect(leftVideo?.sourceOutMs).toBe(1000)
    expect(rightVideo?.sourceInMs).toBe(1000)
    expect(rightVideo?.sourceOutMs).toBe(2000)
    expect(leftVideo?.linkGroupId).toBe(leftAudio?.linkGroupId)
    expect(rightVideo?.linkGroupId).toBe(rightAudio?.linkGroupId)
    expect(leftVideo?.linkGroupId).not.toBe(rightVideo?.linkGroupId)
  })

  it('refuses a cut on the first or last frame', () => {
    let document = createEmptyProject('Test')
    const result = addMediaSource(document, avSource('m1', 'one.mp4', 2000))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    document = result.document
    const placed = addMediaToTimeline({ document, mediaSourceId: 'm1' })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    document = placed.document
    const video = document.clips[0]
    expect(video).toBeTruthy()
    if (!video) return

    const split = splitClipAtTime(document, video.id, video.timelineStartMs)
    expect(split.ok).toBe(false)
    expect(document.clips).toHaveLength(2)
  })
})
