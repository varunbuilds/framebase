import type { Clip, MediaSource, ProjectDocument, TimeMs, Track } from '@/types/timeline'
import { createId } from '@/utils/id'
import { clamp, clipDurationMs } from '@/utils/time'
import {
  getClipById,
  getMediaSourceById,
  getTrackById,
  touchDocument,
} from './project'

export type OperationResult =
  | { ok: true; document: ProjectDocument; clipId?: string }
  | { ok: false; error: string }

function replaceClip(document: ProjectDocument, nextClip: Clip): ProjectDocument {
  return touchDocument({
    ...document,
    clips: document.clips.map((clip) =>
      clip.id === nextClip.id ? nextClip : clip,
    ),
  })
}

export function addMediaSource(
  document: ProjectDocument,
  source: Omit<MediaSource, 'id' | 'importedAt'> & { id?: string },
): OperationResult {
  const mediaSource: MediaSource = {
    ...source,
    id: source.id ?? createId('media'),
    importedAt: new Date().toISOString(),
  }

  return {
    ok: true,
    document: touchDocument({
      ...document,
      mediaSources: [...document.mediaSources, mediaSource],
    }),
  }
}

export function removeMediaSource(
  document: ProjectDocument,
  mediaSourceId: string,
): OperationResult {
  const source = getMediaSourceById(document, mediaSourceId)
  if (!source) {
    return { ok: false, error: 'Media source not found.' }
  }

  return {
    ok: true,
    document: touchDocument({
      ...document,
      mediaSources: document.mediaSources.filter((item) => item.id !== mediaSourceId),
      clips: document.clips.filter((clip) => clip.mediaSourceId !== mediaSourceId),
    }),
  }
}

export function addClipFromMedia(args: {
  document: ProjectDocument
  mediaSourceId: string
  trackId?: string
  timelineStartMs?: TimeMs
}): OperationResult {
  const { document, mediaSourceId } = args
  const source = getMediaSourceById(document, mediaSourceId)
  if (!source) {
    return { ok: false, error: 'Media source not found.' }
  }

  const preferredTrack =
    (args.trackId ? getTrackById(document, args.trackId) : undefined) ??
    document.tracks.find((track) => track.kind === source.kind)

  if (!preferredTrack) {
    return {
      ok: false,
      error: `No ${source.kind} track available for this media.`,
    }
  }

  if (preferredTrack.kind !== source.kind) {
    return {
      ok: false,
      error: `Cannot place ${source.kind} media on a ${preferredTrack.kind} track.`,
    }
  }

  if (preferredTrack.locked) {
    return { ok: false, error: 'Track is locked.' }
  }

  const timelineStartMs = Math.max(0, Math.round(args.timelineStartMs ?? 0))
  const clip: Clip = {
    id: createId('clip'),
    mediaSourceId: source.id,
    trackId: preferredTrack.id,
    timelineStartMs,
    sourceInMs: 0,
    sourceOutMs: source.durationMs,
    label: source.name,
  }

  return {
    ok: true,
    clipId: clip.id,
    document: touchDocument({
      ...document,
      clips: [...document.clips, clip],
    }),
  }
}

export function deleteClip(
  document: ProjectDocument,
  clipId: string,
): OperationResult {
  if (!getClipById(document, clipId)) {
    return { ok: false, error: 'Clip not found.' }
  }

  return {
    ok: true,
    document: touchDocument({
      ...document,
      clips: document.clips.filter((clip) => clip.id !== clipId),
    }),
  }
}

export function moveClip(args: {
  document: ProjectDocument
  clipId: string
  timelineStartMs: TimeMs
  trackId?: string
}): OperationResult {
  const clip = getClipById(args.document, args.clipId)
  if (!clip) {
    return { ok: false, error: 'Clip not found.' }
  }

  const trackId = args.trackId ?? clip.trackId
  const track = getTrackById(args.document, trackId)
  if (!track) {
    return { ok: false, error: 'Track not found.' }
  }

  const source = getMediaSourceById(args.document, clip.mediaSourceId)
  if (!source) {
    return { ok: false, error: 'Media source missing for clip.' }
  }

  if (track.kind !== source.kind) {
    return {
      ok: false,
      error: `Cannot move ${source.kind} clip onto a ${track.kind} track.`,
    }
  }

  if (track.locked) {
    return { ok: false, error: 'Track is locked.' }
  }

  const nextClip: Clip = {
    ...clip,
    trackId,
    timelineStartMs: Math.max(0, Math.round(args.timelineStartMs)),
  }

  return { ok: true, document: replaceClip(args.document, nextClip) }
}

export function trimClip(args: {
  document: ProjectDocument
  clipId: string
  sourceInMs?: TimeMs
  sourceOutMs?: TimeMs
  timelineStartMs?: TimeMs
}): OperationResult {
  const clip = getClipById(args.document, args.clipId)
  if (!clip) {
    return { ok: false, error: 'Clip not found.' }
  }

  const source = getMediaSourceById(args.document, clip.mediaSourceId)
  if (!source) {
    return { ok: false, error: 'Media source missing for clip.' }
  }

  let sourceInMs = Math.round(args.sourceInMs ?? clip.sourceInMs)
  let sourceOutMs = Math.round(args.sourceOutMs ?? clip.sourceOutMs)
  let timelineStartMs = Math.round(args.timelineStartMs ?? clip.timelineStartMs)

  sourceInMs = clamp(sourceInMs, 0, source.durationMs)
  sourceOutMs = clamp(sourceOutMs, 0, source.durationMs)

  if (sourceOutMs - sourceInMs < 100) {
    return { ok: false, error: 'Clip is too short (minimum 0.1s).' }
  }

  timelineStartMs = Math.max(0, timelineStartMs)

  const nextClip: Clip = {
    ...clip,
    sourceInMs,
    sourceOutMs,
    timelineStartMs,
  }

  return { ok: true, document: replaceClip(args.document, nextClip) }
}

export function updateClipLabel(
  document: ProjectDocument,
  clipId: string,
  label: string,
): OperationResult {
  const clip = getClipById(document, clipId)
  if (!clip) {
    return { ok: false, error: 'Clip not found.' }
  }

  return {
    ok: true,
    document: replaceClip(document, { ...clip, label: label.trim() || clip.label }),
  }
}

export function renameProject(
  document: ProjectDocument,
  name: string,
): OperationResult {
  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, error: 'Project name cannot be empty.' }
  }

  return {
    ok: true,
    document: touchDocument({
      ...document,
      name: trimmed,
    }),
  }
}

export function getClipPlaybackRange(clip: Clip): {
  durationMs: TimeMs
  timelineEndMs: TimeMs
} {
  const durationMs = clipDurationMs(clip.sourceInMs, clip.sourceOutMs)
  return {
    durationMs,
    timelineEndMs: clip.timelineStartMs + durationMs,
  }
}

export function findClipAtPlayhead(
  document: ProjectDocument,
  playheadMs: TimeMs,
  preferredKind?: Track['kind'],
): Clip | undefined {
  const candidates = document.clips.filter((clip) => {
    const { timelineEndMs } = getClipPlaybackRange(clip)
    return playheadMs >= clip.timelineStartMs && playheadMs < timelineEndMs
  })

  if (preferredKind) {
    const preferred = candidates.find((clip) => {
      const source = getMediaSourceById(document, clip.mediaSourceId)
      return source?.kind === preferredKind
    })
    if (preferred) return preferred
  }

  return candidates[0]
}
