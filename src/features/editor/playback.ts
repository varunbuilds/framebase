import type { Clip, ProjectDocument, TimeMs, Track } from '@/types/timeline'
import { getClipPlaybackRange } from '@/features/editor/operations'
import {
  getClipsForTrack,
  getMediaSourceById,
  getSortedTracks,
} from '@/features/editor/project'
import { clamp } from '@/utils/time'

/**
 * Playback track policy (Milestone: timeline playback v1)
 *
 * The preview engine plays a single active track — never a multi-track composite.
 *
 * Priority:
 * 1. The video track with the lowest `order` value (typically "Video 1").
 * 2. If no video track exists, the audio track with the lowest `order`.
 *
 * Clips on other tracks are ignored by this playback engine. Gaps on the active
 * track render as an empty/black preview. Audio from non-active tracks is not mixed.
 */
export function resolvePlaybackTrack(
  document: ProjectDocument,
): Track | undefined {
  const tracks = getSortedTracks(document)
  return (
    tracks.find((track) => track.kind === 'video') ??
    tracks.find((track) => track.kind === 'audio')
  )
}

/** End of the last clip on the active playback track (not UI ruler padding). */
export function getPlaybackEndMs(
  document: ProjectDocument,
  trackId?: string,
): TimeMs {
  const track = trackId
    ? document.tracks.find((item) => item.id === trackId)
    : resolvePlaybackTrack(document)

  if (!track) return 0

  const clips = getClipsForTrack(document, track.id)
  if (clips.length === 0) return 0

  return clips.reduce((max, clip) => {
    const { timelineEndMs } = getClipPlaybackRange(clip)
    return Math.max(max, timelineEndMs)
  }, 0)
}

export function timelineToSourceTimeMs(
  clip: Clip,
  timelineTimeMs: TimeMs,
): TimeMs {
  const offset = timelineTimeMs - clip.timelineStartMs
  return clip.sourceInMs + Math.max(0, offset)
}

export function sourceToTimelineTimeMs(
  clip: Clip,
  sourceTimeMs: TimeMs,
): TimeMs {
  const offset = sourceTimeMs - clip.sourceInMs
  return clip.timelineStartMs + Math.max(0, offset)
}

export function isTimelineTimeInClip(
  clip: Clip,
  timelineTimeMs: TimeMs,
): boolean {
  const { timelineEndMs } = getClipPlaybackRange(clip)
  return timelineTimeMs >= clip.timelineStartMs && timelineTimeMs < timelineEndMs
}

export type PlaybackResolution =
  | {
      status: 'clip'
      clip: Clip
      trackId: string
      timelineTimeMs: TimeMs
      sourceTimeMs: TimeMs
      mediaSourceId: string
      mediaKind: 'video' | 'audio'
    }
  | {
      status: 'gap'
      trackId: string
      timelineTimeMs: TimeMs
    }
  | {
      status: 'ended'
      trackId: string | null
      timelineTimeMs: TimeMs
    }
  | {
      status: 'empty'
      trackId: string | null
      timelineTimeMs: TimeMs
    }

/**
 * Resolve what the preview should show at a canonical timeline time (ms).
 * Half-open clip intervals: [timelineStart, timelineEnd).
 */
export function resolvePlaybackAt(
  document: ProjectDocument,
  timelineTimeMs: TimeMs,
  options?: { trackId?: string },
): PlaybackResolution {
  const track = options?.trackId
    ? document.tracks.find((item) => item.id === options.trackId)
    : resolvePlaybackTrack(document)

  if (!track) {
    return { status: 'empty', trackId: null, timelineTimeMs }
  }

  const playbackEndMs = getPlaybackEndMs(document, track.id)
  if (playbackEndMs <= 0) {
    return { status: 'empty', trackId: track.id, timelineTimeMs }
  }

  const clampedTime = Math.max(0, Math.round(timelineTimeMs))

  if (clampedTime >= playbackEndMs) {
    return {
      status: 'ended',
      trackId: track.id,
      timelineTimeMs: playbackEndMs,
    }
  }

  const clips = getClipsForTrack(document, track.id)
  const active = clips.find((clip) => isTimelineTimeInClip(clip, clampedTime))

  if (!active) {
    return {
      status: 'gap',
      trackId: track.id,
      timelineTimeMs: clampedTime,
    }
  }

  const media = getMediaSourceById(document, active.mediaSourceId)
  const sourceTimeMs = clamp(
    timelineToSourceTimeMs(active, clampedTime),
    active.sourceInMs,
    // Stay just inside the source out when at the last ms of the clip window.
    Math.max(active.sourceInMs, active.sourceOutMs - 1),
  )

  return {
    status: 'clip',
    clip: active,
    trackId: track.id,
    timelineTimeMs: clampedTime,
    sourceTimeMs,
    mediaSourceId: active.mediaSourceId,
    mediaKind: media?.kind ?? track.kind,
  }
}

/** Advance timeline time during a gap, stopping at the next clip or playback end. */
export function advanceThroughGap(
  document: ProjectDocument,
  timelineTimeMs: TimeMs,
  deltaMs: TimeMs,
  trackId?: string,
): { timelineTimeMs: TimeMs; reachedClipOrEnd: boolean } {
  const track = trackId
    ? document.tracks.find((item) => item.id === trackId)
    : resolvePlaybackTrack(document)

  if (!track) {
    return { timelineTimeMs, reachedClipOrEnd: true }
  }

  const endMs = getPlaybackEndMs(document, track.id)
  const next = Math.min(endMs, timelineTimeMs + Math.max(0, deltaMs))
  const resolution = resolvePlaybackAt(document, next, { trackId: track.id })

  return {
    timelineTimeMs: next,
    reachedClipOrEnd:
      resolution.status === 'clip' ||
      resolution.status === 'ended' ||
      next >= endMs,
  }
}

export function findNextClipStartMs(
  document: ProjectDocument,
  afterMs: TimeMs,
  trackId?: string,
): TimeMs | null {
  const track = trackId
    ? document.tracks.find((item) => item.id === trackId)
    : resolvePlaybackTrack(document)

  if (!track) return null

  const clips = getClipsForTrack(document, track.id)
  const next = clips.find((clip) => clip.timelineStartMs > afterMs)
  return next ? next.timelineStartMs : null
}
