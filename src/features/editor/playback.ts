import type { Clip, ProjectDocument, TimeMs, Track } from '@/types/timeline'
import { getClipPlaybackRange } from '@/features/editor/operations'
import {
  getClipsForTrack,
  getMediaSourceById,
  getSortedTracks,
} from '@/features/editor/project'
import { clamp } from '@/utils/time'

/**
 * Video playback selects one clip at the playhead, not one track for the
 * whole timeline.
 *
 * Track.order is already the timeline's visual order: lower order is drawn
 * higher and is the foreground. New video tracks are inserted above Video 1
 * with a smaller order. At each time, the clip on the lowest-order video
 * track that contains the playhead is the picture. A gap on that track falls
 * through to the next video track. Audio tracks never supply the picture.
 *
 * One HTML video element still plays that clip. This is not compositing.
 * Muted and locked do not hide a video clip; those flags are not part of
 * preview selection today.
 *
 * A project with no video tracks still plays its lowest-order audio track.
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

/** End of picture playback: the latest video clip, or the audio fallback track. */
export function getPlaybackEndMs(
  document: ProjectDocument,
  trackId?: string,
): TimeMs {
  if (!trackId && document.tracks.some((track) => track.kind === 'video')) {
    let end: TimeMs = 0
    for (const track of document.tracks) {
      if (track.kind !== 'video') continue
      for (const clip of getClipsForTrack(document, track.id)) {
        end = Math.max(end, getClipPlaybackRange(clip).timelineEndMs)
      }
    }
    return end
  }

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

function sourceTimeForClip(clip: Clip, timelineTimeMs: TimeMs): TimeMs {
  return clamp(
    timelineToSourceTimeMs(clip, timelineTimeMs),
    clip.sourceInMs,
    Math.max(clip.sourceInMs, clip.sourceOutMs - 1),
  )
}

export type ActiveVideoClip = {
  clip: Clip
  track: Track
  timelineTimeMs: TimeMs
  sourceTimeMs: TimeMs
}

/**
 * Foreground video clip at the playhead. Video tracks only, lowest
 * Track.order first (top of the timeline). Half-open intervals.
 */
export function resolveActiveVideoClip(
  document: ProjectDocument,
  playheadMs: TimeMs,
): ActiveVideoClip | null {
  const timelineTimeMs = Math.max(0, Math.round(playheadMs))
  const videoTracks = getSortedTracks(document).filter(
    (track) => track.kind === 'video',
  )

  for (const track of videoTracks) {
    const clip = getClipsForTrack(document, track.id).find((candidate) =>
      isTimelineTimeInClip(candidate, timelineTimeMs),
    )
    if (!clip) continue
    return {
      clip,
      track,
      timelineTimeMs,
      sourceTimeMs: sourceTimeForClip(clip, timelineTimeMs),
    }
  }

  return null
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
  if (options?.trackId) {
    return resolveTrackPlayback(document, options.trackId, timelineTimeMs)
  }

  const hasVideo = document.tracks.some((track) => track.kind === 'video')
  if (!hasVideo) {
    const audio = resolvePlaybackTrack(document)
    if (!audio) {
      return { status: 'empty', trackId: null, timelineTimeMs }
    }
    return resolveTrackPlayback(document, audio.id, timelineTimeMs)
  }

  const foreground =
    getSortedTracks(document).find((track) => track.kind === 'video') ?? null
  const playbackEndMs = getPlaybackEndMs(document)
  if (playbackEndMs <= 0) {
    return { status: 'empty', trackId: foreground?.id ?? null, timelineTimeMs }
  }

  const clampedTime = Math.max(0, Math.round(timelineTimeMs))
  if (clampedTime >= playbackEndMs) {
    return {
      status: 'ended',
      trackId: foreground?.id ?? null,
      timelineTimeMs: playbackEndMs,
    }
  }

  const active = resolveActiveVideoClip(document, clampedTime)
  if (!active) {
    return {
      status: 'gap',
      trackId: foreground?.id ?? '',
      timelineTimeMs: clampedTime,
    }
  }

  const media = getMediaSourceById(document, active.clip.mediaSourceId)
  return {
    status: 'clip',
    clip: active.clip,
    trackId: active.track.id,
    timelineTimeMs: active.timelineTimeMs,
    sourceTimeMs: active.sourceTimeMs,
    mediaSourceId: active.clip.mediaSourceId,
    mediaKind: media?.kind ?? 'video',
  }
}

function resolveTrackPlayback(
  document: ProjectDocument,
  trackId: string,
  timelineTimeMs: TimeMs,
): PlaybackResolution {
  const track = document.tracks.find((item) => item.id === trackId)
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

  const active = getClipsForTrack(document, track.id).find((clip) =>
    isTimelineTimeInClip(clip, clampedTime),
  )
  if (!active) {
    return {
      status: 'gap',
      trackId: track.id,
      timelineTimeMs: clampedTime,
    }
  }

  const media = getMediaSourceById(document, active.mediaSourceId)
  return {
    status: 'clip',
    clip: active,
    trackId: track.id,
    timelineTimeMs: clampedTime,
    sourceTimeMs: sourceTimeForClip(active, clampedTime),
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
  const endMs = trackId
    ? getPlaybackEndMs(document, trackId)
    : getPlaybackEndMs(document)
  if (endMs <= 0) {
    return { timelineTimeMs, reachedClipOrEnd: true }
  }

  const next = Math.min(endMs, timelineTimeMs + Math.max(0, deltaMs))
  const resolution = resolvePlaybackAt(
    document,
    next,
    trackId ? { trackId } : undefined,
  )

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
  const tracks = trackId
    ? document.tracks.filter((item) => item.id === trackId)
    : document.tracks.some((item) => item.kind === 'video')
      ? document.tracks.filter((item) => item.kind === 'video')
      : document.tracks.filter((item) => item.id === resolvePlaybackTrack(document)?.id)

  let nextStart: TimeMs | null = null
  for (const track of tracks) {
    for (const clip of getClipsForTrack(document, track.id)) {
      if (clip.timelineStartMs <= afterMs) continue
      nextStart =
        nextStart == null
          ? clip.timelineStartMs
          : Math.min(nextStart, clip.timelineStartMs)
    }
  }
  return nextStart
}
