import type { Clip, MediaSource, ProjectDocument, TimeMs, Track } from '@/types/timeline'
import {
  getClipById,
  getLinkedClips,
  getMediaSourceById,
  getTrackById,
} from './project'

/**
 * Every value an edit needs is on the operation.
 * applyOperation does not allocate ids or read the clock.
 */
export type EditorOperation =
  | { type: 'media.add'; source: MediaSource }
  | { type: 'media.remove'; mediaSourceId: string }
  | { type: 'track.add'; track: Track }
  | { type: 'track.remove'; trackId: string }
  | { type: 'clip.add'; clip: Clip }
  | {
      type: 'clip.move'
      clipId: string
      timelineStartMs: TimeMs
      trackId: string
    }
  | {
      type: 'clip.trim'
      clipId: string
      sourceInMs: TimeMs
      sourceOutMs: TimeMs
      timelineStartMs: TimeMs
    }
  | { type: 'clip.delete'; clipId: string }
  | { type: 'clip.link'; clipIds: string[]; linkGroupId: string }
  | { type: 'clip.unlink'; clipIds: string[] }
  | {
      type: 'clip.split'
      cuts: Array<{ clipId: string; sourceOutMs: TimeMs; right: Clip }>
    }
  | { type: 'clip.relabel'; clipId: string; label: string }
  | { type: 'project.rename'; name: string }

export type ApplyResult =
  | { ok: true; document: ProjectDocument }
  | { ok: false; error: string }

function withClips(document: ProjectDocument, clips: Clip[]): ProjectDocument {
  return { ...document, clips }
}

export function applyOperation(
  document: ProjectDocument,
  operation: EditorOperation,
): ApplyResult {
  switch (operation.type) {
    case 'media.add':
      return applyMediaAdd(document, operation.source)
    case 'media.remove':
      return applyMediaRemove(document, operation.mediaSourceId)
    case 'track.add':
      return applyTrackAdd(document, operation.track)
    case 'track.remove':
      return applyTrackRemove(document, operation.trackId)
    case 'clip.add':
      return applyClipAdd(document, operation.clip)
    case 'clip.move':
      return applyClipMove(document, operation)
    case 'clip.trim':
      return applyClipTrim(document, operation)
    case 'clip.delete':
      return applyClipDelete(document, operation.clipId)
    case 'clip.link':
      return applyClipLink(document, operation.clipIds, operation.linkGroupId)
    case 'clip.unlink':
      return applyClipUnlink(document, operation.clipIds)
    case 'clip.split':
      return applyClipSplit(document, operation.cuts)
    case 'clip.relabel':
      return applyClipRelabel(document, operation.clipId, operation.label)
    case 'project.rename':
      return applyRename(document, operation.name)
    default: {
      const unexpected: never = operation
      return { ok: false, error: `Unknown operation: ${String(unexpected)}` }
    }
  }
}

export function applyOperations(
  document: ProjectDocument,
  operations: EditorOperation[],
): ApplyResult {
  let next = document
  for (const operation of operations) {
    const result = applyOperation(next, operation)
    if (!result.ok) return result
    next = result.document
  }
  return { ok: true, document: next }
}

function applyMediaAdd(
  document: ProjectDocument,
  source: MediaSource,
): ApplyResult {
  if (!source.id) return { ok: false, error: 'Media source id is required.' }
  if (getMediaSourceById(document, source.id)) {
    return { ok: false, error: 'Media source already exists.' }
  }
  if (!source.importedAt) {
    return { ok: false, error: 'Media importedAt is required.' }
  }
  return {
    ok: true,
    document: {
      ...document,
      mediaSources: [...document.mediaSources, source],
    },
  }
}

function applyMediaRemove(
  document: ProjectDocument,
  mediaSourceId: string,
): ApplyResult {
  const source = getMediaSourceById(document, mediaSourceId)
  if (!source) return { ok: false, error: 'Media source not found.' }
  return {
    ok: true,
    document: {
      ...document,
      mediaSources: document.mediaSources.filter((item) => item.id !== mediaSourceId),
      clips: document.clips.filter((clip) => clip.mediaSourceId !== mediaSourceId),
    },
  }
}

function applyTrackAdd(document: ProjectDocument, track: Track): ApplyResult {
  if (!track.id) return { ok: false, error: 'Track id is required.' }
  if (getTrackById(document, track.id)) {
    return { ok: false, error: 'Track already exists.' }
  }
  return {
    ok: true,
    document: { ...document, tracks: [...document.tracks, track] },
  }
}

function applyTrackRemove(
  document: ProjectDocument,
  trackId: string,
): ApplyResult {
  const track = getTrackById(document, trackId)
  if (!track) return { ok: false, error: 'Track not found.' }
  if (document.clips.some((clip) => clip.trackId === trackId)) {
    return { ok: false, error: 'Track still contains clips.' }
  }
  return {
    ok: true,
    document: {
      ...document,
      tracks: document.tracks.filter((item) => item.id !== trackId),
    },
  }
}

function applyClipAdd(document: ProjectDocument, clip: Clip): ApplyResult {
  if (!clip.id) return { ok: false, error: 'Clip id is required.' }
  if (getClipById(document, clip.id)) {
    return { ok: false, error: 'Clip already exists.' }
  }
  const source = getMediaSourceById(document, clip.mediaSourceId)
  if (!source) return { ok: false, error: 'Media source not found.' }
  const track = getTrackById(document, clip.trackId)
  if (!track) return { ok: false, error: 'Track not found.' }
  if (track.locked) return { ok: false, error: 'Track is locked.' }
  if (track.kind === 'video' && !source.hasVideo) {
    return { ok: false, error: 'This media has no video stream.' }
  }
  if (track.kind === 'audio' && !source.hasAudio) {
    return { ok: false, error: 'This media has no audio stream.' }
  }
  return { ok: true, document: withClips(document, [...document.clips, clip]) }
}

function applyClipMove(
  document: ProjectDocument,
  operation: Extract<EditorOperation, { type: 'clip.move' }>,
): ApplyResult {
  const clip = getClipById(document, operation.clipId)
  if (!clip) return { ok: false, error: 'Clip not found.' }

  const track = getTrackById(document, operation.trackId)
  if (!track) return { ok: false, error: 'Track not found.' }

  const source = getMediaSourceById(document, clip.mediaSourceId)
  if (!source) return { ok: false, error: 'Media source missing for clip.' }

  const currentTrack = getTrackById(document, clip.trackId)
  if (!currentTrack) return { ok: false, error: 'Clip track not found.' }
  if (track.kind !== currentTrack.kind) {
    return {
      ok: false,
      error: `Cannot move a ${currentTrack.kind} clip onto a ${track.kind} track.`,
    }
  }
  if (track.locked) return { ok: false, error: 'Track is locked.' }
  if (currentTrack.kind === 'video' && !source.hasVideo) {
    return { ok: false, error: 'This media has no video stream.' }
  }
  if (currentTrack.kind === 'audio' && !source.hasAudio) {
    return { ok: false, error: 'This media has no audio stream.' }
  }

  const nextClip: Clip = {
    ...clip,
    trackId: operation.trackId,
    timelineStartMs: operation.timelineStartMs,
  }
  return {
    ok: true,
    document: withClips(
      document,
      document.clips.map((item) => (item.id === nextClip.id ? nextClip : item)),
    ),
  }
}

function applyClipTrim(
  document: ProjectDocument,
  operation: Extract<EditorOperation, { type: 'clip.trim' }>,
): ApplyResult {
  const clip = getClipById(document, operation.clipId)
  if (!clip) return { ok: false, error: 'Clip not found.' }
  if (!getMediaSourceById(document, clip.mediaSourceId)) {
    return { ok: false, error: 'Media source missing for clip.' }
  }
  if (operation.sourceOutMs - operation.sourceInMs < 100) {
    return { ok: false, error: 'Clip is too short (minimum 0.1s).' }
  }
  const nextClip: Clip = {
    ...clip,
    sourceInMs: operation.sourceInMs,
    sourceOutMs: operation.sourceOutMs,
    timelineStartMs: operation.timelineStartMs,
  }
  return {
    ok: true,
    document: withClips(
      document,
      document.clips.map((item) => (item.id === nextClip.id ? nextClip : item)),
    ),
  }
}

function applyClipDelete(
  document: ProjectDocument,
  clipId: string,
): ApplyResult {
  const clip = getClipById(document, clipId)
  if (!clip) return { ok: false, error: 'Clip not found.' }

  const removeIds = new Set(
    clip.linkGroupId
      ? document.clips
          .filter((item) => item.linkGroupId === clip.linkGroupId)
          .map((item) => item.id)
      : [clipId],
  )
  return {
    ok: true,
    document: withClips(
      document,
      document.clips.filter((item) => !removeIds.has(item.id)),
    ),
  }
}

function applyClipLink(
  document: ProjectDocument,
  clipIds: string[],
  linkGroupId: string,
): ApplyResult {
  if (!linkGroupId) return { ok: false, error: 'Link group id is required.' }
  const uniqueIds = [...new Set(clipIds)]
  const clips = uniqueIds
    .map((id) => getClipById(document, id))
    .filter((clip): clip is Clip => clip != null)

  if (clips.length < 2) {
    return {
      ok: false,
      error: 'Select at least one video clip and one audio clip to link.',
    }
  }

  const kinds = new Set<Track['kind']>()
  for (const clip of clips) {
    const track = getTrackById(document, clip.trackId)
    if (!track) return { ok: false, error: 'Clip track not found.' }
    kinds.add(track.kind)
  }
  if (!kinds.has('video') || !kinds.has('audio')) {
    return {
      ok: false,
      error: 'Link requires at least one video clip and one audio clip.',
    }
  }

  const selectedIds = new Set(clips.map((clip) => clip.id))
  for (const clip of clips) {
    if (!clip.linkGroupId) continue
    const group = getLinkedClips(document, clip.id)
    if (group.some((member) => !selectedIds.has(member.id))) {
      return {
        ok: false,
        error: 'Unlink existing partners before linking a new selection.',
      }
    }
  }

  const linkedIds = new Set(clips.map((clip) => clip.id))
  return {
    ok: true,
    document: withClips(
      document,
      document.clips.map((clip) =>
        linkedIds.has(clip.id) ? { ...clip, linkGroupId } : clip,
      ),
    ),
  }
}

function applyClipUnlink(
  document: ProjectDocument,
  clipIds: string[],
): ApplyResult {
  const groups = new Set<string>()
  for (const clipId of clipIds) {
    const clip = getClipById(document, clipId)
    if (clip?.linkGroupId) groups.add(clip.linkGroupId)
  }
  if (groups.size === 0) return { ok: true, document }
  return {
    ok: true,
    document: withClips(
      document,
      document.clips.map((clip) =>
        clip.linkGroupId && groups.has(clip.linkGroupId)
          ? { ...clip, linkGroupId: undefined }
          : clip,
      ),
    ),
  }
}

function applyClipSplit(
  document: ProjectDocument,
  cuts: Array<{ clipId: string; sourceOutMs: TimeMs; right: Clip }>,
): ApplyResult {
  if (cuts.length === 0) {
    return { ok: false, error: 'Split requires at least one cut.' }
  }
  let clips = document.clips
  for (const cut of cuts) {
    const clip = clips.find((item) => item.id === cut.clipId)
    if (!clip) return { ok: false, error: 'Clip not found.' }
    if (clips.some((item) => item.id === cut.right.id)) {
      return { ok: false, error: 'Split clip id already exists.' }
    }
    const left: Clip = { ...clip, sourceOutMs: cut.sourceOutMs }
    clips = clips.map((item) => (item.id === clip.id ? left : item)).concat(cut.right)
  }
  return { ok: true, document: withClips(document, clips) }
}

function applyClipRelabel(
  document: ProjectDocument,
  clipId: string,
  label: string,
): ApplyResult {
  const clip = getClipById(document, clipId)
  if (!clip) return { ok: false, error: 'Clip not found.' }
  return {
    ok: true,
    document: withClips(
      document,
      document.clips.map((item) => (item.id === clipId ? { ...item, label } : item)),
    ),
  }
}

function applyRename(document: ProjectDocument, name: string): ApplyResult {
  if (!name) return { ok: false, error: 'Project name cannot be empty.' }
  return { ok: true, document: { ...document, name } }
}
