import { describe, expect, it } from 'vitest'
import {
  addMediaSource,
  addMediaToTimeline,
  moveClipOnTimeline,
} from '@/features/editor/operations'
import {
  createEmptyProject,
  getSortedTracks,
} from '@/features/editor/project'
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
    locator: { kind: 'runtime' },
    availability: 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
  }
}

function placeTwoAvClips() {
  let document = createEmptyProject('Test')
  for (const source of [
    avSource('m1', 'one.mp4', 2000),
    avSource('m2', 'two.mp4', 2000),
  ]) {
    const added = addMediaSource(document, source)
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error(added.error)
    document = added.document
  }

  for (const mediaSourceId of ['m1', 'm2']) {
    const placed = addMediaToTimeline({ document, mediaSourceId })
    expect(placed.ok).toBe(true)
    if (!placed.ok) throw new Error(placed.error)
    document = placed.document
  }

  return document
}

describe('moveClipOnTimeline collision lanes', () => {
  it('promotes overlapping video up and demotes overlapping linked audio down', () => {
    let document = placeTwoAvClips()

    const video1 = document.tracks.find(
      (track) => track.kind === 'video' && track.name === 'Video 1',
    )!
    const audio1 = document.tracks.find(
      (track) => track.kind === 'audio' && track.name === 'Audio 1',
    )!

    const m2Video = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' && clip.trackId === video1.id,
    )!
    expect(m2Video.timelineStartMs).toBe(2000)

    // Drag media2 left over media1 — both streams collide on V1/A1.
    const moved = moveClipOnTimeline({
      document,
      clipId: m2Video.id,
      timelineStartMs: 500,
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    document = moved.document

    const tracks = getSortedTracks(document)
    const videoTracks = tracks.filter((track) => track.kind === 'video')
    const audioTracks = tracks.filter((track) => track.kind === 'audio')
    expect(videoTracks).toHaveLength(2)
    expect(audioTracks).toHaveLength(2)

    // Video 2 is above Video 1 (lower order / earlier in sort).
    expect(videoTracks[0]?.order).toBeLessThan(videoTracks[1]!.order)
    expect(videoTracks[0]?.name).toBe('Video 2')
    expect(audioTracks[1]?.name).toBe('Audio 2')

    const m1Video = document.clips.find(
      (clip) => clip.mediaSourceId === 'm1' && clip.trackId === video1.id,
    )!
    const m1Audio = document.clips.find(
      (clip) => clip.mediaSourceId === 'm1' && clip.trackId === audio1.id,
    )!

    const m2VideoMoved = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        clip.linkGroupId === m2Video.linkGroupId &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'video',
    )!
    const m2AudioMoved = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        clip.linkGroupId === m2Video.linkGroupId &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'audio',
    )!

    expect(m1Video.trackId).toBe(video1.id)
    expect(m1Audio.trackId).toBe(audio1.id)
    expect(m2VideoMoved.trackId).toBe(videoTracks[0]!.id)
    expect(m2AudioMoved.trackId).toBe(audioTracks[1]!.id)
    expect(m2VideoMoved.timelineStartMs).toBe(500)
    expect(m2AudioMoved.timelineStartMs).toBe(500)

    // No two clips share an overlapping range on the same track.
    for (const track of document.tracks) {
      const onTrack = document.clips
        .filter((clip) => clip.trackId === track.id)
        .sort((a, b) => a.timelineStartMs - b.timelineStartMs)
      for (let i = 0; i < onTrack.length - 1; i += 1) {
        const left = onTrack[i]!
        const right = onTrack[i + 1]!
        const leftEnd =
          left.timelineStartMs + (left.sourceOutMs - left.sourceInMs)
        expect(leftEnd).toBeLessThanOrEqual(right.timelineStartMs)
      }
    }
  })

  it('keeps linked audio on Audio 1 when only video collides', () => {
    let document = placeTwoAvClips()
    const video1 = document.tracks.find((track) => track.kind === 'video')!
    const audio1 = document.tracks.find((track) => track.kind === 'audio')!

    // Shorten m1 audio so m2 audio can sit at 500 without colliding,
    // while m1 video still occupies 0–2000.
    const m1Audio = document.clips.find(
      (clip) => clip.mediaSourceId === 'm1' && clip.trackId === audio1.id,
    )!
    document = {
      ...document,
      clips: document.clips.map((clip) =>
        clip.id === m1Audio.id
          ? { ...clip, sourceOutMs: clip.sourceInMs + 400 }
          : clip,
      ),
    }

    const m2Video = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' && clip.trackId === video1.id,
    )!

    const moved = moveClipOnTimeline({
      document,
      clipId: m2Video.id,
      timelineStartMs: 500,
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    document = moved.document

    const videoTracks = getSortedTracks(document).filter(
      (track) => track.kind === 'video',
    )
    const audioTracks = getSortedTracks(document).filter(
      (track) => track.kind === 'audio',
    )
    expect(videoTracks).toHaveLength(2)
    expect(audioTracks).toHaveLength(1)

    const m2VideoMoved = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'video',
    )!
    const m2AudioMoved = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'audio',
    )!

    expect(m2VideoMoved.trackId).toBe(videoTracks[0]!.id)
    expect(m2AudioMoved.trackId).toBe(audio1.id)
  })

  it('folds clips back to Video 1 / Audio 1 and prunes empty lanes', () => {
    let document = placeTwoAvClips()
    const video1 = document.tracks.find(
      (track) => track.kind === 'video' && track.name === 'Video 1',
    )!

    const m2Video = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' && clip.trackId === video1.id,
    )!

    const overlapped = moveClipOnTimeline({
      document,
      clipId: m2Video.id,
      timelineStartMs: 500,
    })
    expect(overlapped.ok).toBe(true)
    if (!overlapped.ok) return
    document = overlapped.document
    expect(
      getSortedTracks(document).filter((track) => track.kind === 'video'),
    ).toHaveLength(2)

    const m2VideoLane = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'video',
    )!

    const cleared = moveClipOnTimeline({
      document,
      clipId: m2VideoLane.id,
      timelineStartMs: 2000,
    })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    document = cleared.document

    const videoTracks = getSortedTracks(document).filter(
      (track) => track.kind === 'video',
    )
    const audioTracks = getSortedTracks(document).filter(
      (track) => track.kind === 'audio',
    )
    expect(videoTracks).toHaveLength(1)
    expect(audioTracks).toHaveLength(1)

    const m2VideoHome = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'video',
    )!
    const m2AudioHome = document.clips.find(
      (clip) =>
        clip.mediaSourceId === 'm2' &&
        document.tracks.find((track) => track.id === clip.trackId)?.kind ===
          'audio',
    )!

    expect(m2VideoHome.trackId).toBe(videoTracks[0]!.id)
    expect(m2AudioHome.trackId).toBe(audioTracks[0]!.id)
    expect(m2VideoHome.timelineStartMs).toBe(2000)
  })
})
