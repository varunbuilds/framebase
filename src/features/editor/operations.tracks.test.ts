import { describe, expect, it } from 'vitest'
import {
  addTimelineTrack,
  removeTimelineTrack,
  updateTrack,
} from '@/features/editor/operations'
import { createEmptyProject } from '@/features/editor/project'
import type { Clip, ProjectDocument } from '@/types/timeline'

function withClip(document: ProjectDocument): ProjectDocument {
  const video = document.tracks.find((track) => track.kind === 'video')
  const source = {
    id: 'media_1',
    name: 'clip.mp4',
    kind: 'video' as const,
    hasVideo: true,
    hasAudio: true,
    durationMs: 4000,
    mimeType: 'video/mp4',
    locator: { kind: 'runtime' as const },
    availability: 'available' as const,
    importedAt: '2026-01-01T00:00:00.000Z',
  }
  const clip: Clip = {
    id: 'clip_1',
    mediaSourceId: source.id,
    trackId: video!.id,
    timelineStartMs: 0,
    sourceInMs: 0,
    sourceOutMs: 1000,
  }
  return {
    ...document,
    mediaSources: [source],
    clips: [clip],
  }
}

describe('timeline tracks', () => {
  it('adds a video lane above and an audio lane below', () => {
    const document = createEmptyProject('Cut')
    const video = addTimelineTrack(document, 'video')
    expect(video.ok).toBe(true)
    if (!video.ok) return
    const addedVideo = video.document.tracks.find((track) => track.name === 'Video 2')
    expect(addedVideo).toMatchObject({ kind: 'video', muted: false, locked: false })
    expect(addedVideo!.order).toBeLessThan(0)

    const audio = addTimelineTrack(video.document, 'audio')
    expect(audio.ok).toBe(true)
    if (!audio.ok) return
    const addedAudio = audio.document.tracks.find((track) => track.name === 'Audio 2')
    expect(addedAudio).toMatchObject({ kind: 'audio' })
    expect(addedAudio!.order).toBeGreaterThan(1)
  })

  it('mutes and locks a track without removing it', () => {
    const document = createEmptyProject('Cut')
    const trackId = document.tracks[0]!.id
    const muted = updateTrack(document, trackId, { muted: true })
    expect(muted.ok).toBe(true)
    if (!muted.ok) return
    expect(muted.document.tracks[0]).toMatchObject({ muted: true, locked: false })
    const locked = updateTrack(muted.document, trackId, { locked: true })
    expect(locked.ok).toBe(true)
    if (!locked.ok) return
    expect(locked.document.tracks.find((track) => track.id === trackId)).toMatchObject({
      muted: true,
      locked: true,
    })
  })

  it('deletes a track and the clips on it in one step', () => {
    const document = withClip(createEmptyProject('Cut'))
    const videoId = document.tracks.find((track) => track.kind === 'video')!.id
    const removed = removeTimelineTrack(document, videoId)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.document.tracks.some((track) => track.id === videoId)).toBe(false)
    expect(removed.document.clips).toEqual([])
    expect(removed.document.tracks.some((track) => track.kind === 'audio')).toBe(true)
  })
})
