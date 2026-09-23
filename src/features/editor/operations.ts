import type { Clip, MediaSource, ProjectDocument, TimeMs, Track } from '@/types/timeline'
import { createId } from '@/utils/id'
import { clamp, clipDurationMs } from '@/utils/time'
import {
  getClipById,
  getLinkedClips,
  getMediaSourceById,
  getTrackById,
  getTrackContentEndMs,
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

function replaceClips(
  document: ProjectDocument,
  nextClips: Clip[],
): ProjectDocument {
  const byId = new Map(nextClips.map((clip) => [clip.id, clip]))
  return touchDocument({
    ...document,
    clips: document.clips.map((clip) => byId.get(clip.id) ?? clip),
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
  /** Which stream to place. Defaults to the source primary kind. */
  role?: Track['kind']
  trackId?: string
  timelineStartMs?: TimeMs
  linkGroupId?: string
}): OperationResult {
  const { document, mediaSourceId } = args
  const source = getMediaSourceById(document, mediaSourceId)
  if (!source) {
    return { ok: false, error: 'Media source not found.' }
  }

  const role =
    args.role ??
    (source.hasVideo ? 'video' : source.hasAudio ? 'audio' : source.kind)

  if (role === 'video' && !source.hasVideo) {
    return { ok: false, error: 'This media has no video stream.' }
  }
  if (role === 'audio' && !source.hasAudio) {
    return { ok: false, error: 'This media has no audio stream.' }
  }

  const preferredTrack =
    (args.trackId ? getTrackById(document, args.trackId) : undefined) ??
    document.tracks.find((track) => track.kind === role)

  if (!preferredTrack) {
    return {
      ok: false,
      error: `No ${role} track available for this media.`,
    }
  }

  if (preferredTrack.kind !== role) {
    return {
      ok: false,
      error: `Cannot place ${role} on a ${preferredTrack.kind} track.`,
    }
  }

  if (preferredTrack.locked) {
    return { ok: false, error: 'Track is locked.' }
  }

  const timelineStartMs =
    args.timelineStartMs != null
      ? Math.max(0, Math.round(args.timelineStartMs))
      : getTrackContentEndMs(document, preferredTrack.id)

  const clip: Clip = {
    id: createId('clip'),
    mediaSourceId: source.id,
    trackId: preferredTrack.id,
    timelineStartMs,
    sourceInMs: 0,
    sourceOutMs: source.durationMs,
    label: source.name,
    linkGroupId: args.linkGroupId,
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

/**
 * Place a library item on the timeline after existing clips on each target row.
 * AV files create linked video + audio clips that share a linkGroupId.
 */
export function addMediaToTimeline(args: {
  document: ProjectDocument
  mediaSourceId: string
  timelineStartMs?: TimeMs
}): OperationResult & { clipIds?: string[] } {
  const source = getMediaSourceById(args.document, args.mediaSourceId)
  if (!source) {
    return { ok: false, error: 'Media source not found.' }
  }

  const roles: Track['kind'][] = []
  if (source.hasVideo) roles.push('video')
  if (source.hasAudio) roles.push('audio')
  if (roles.length === 0) {
    return { ok: false, error: 'Media has no playable streams.' }
  }

  let timelineStartMs = args.timelineStartMs
  if (timelineStartMs == null) {
    let endMs = 0
    for (const role of roles) {
      const track = args.document.tracks.find((item) => item.kind === role)
      if (track) {
        endMs = Math.max(endMs, getTrackContentEndMs(args.document, track.id))
      }
    }
    timelineStartMs = endMs
  }

  const linkGroupId = roles.length > 1 ? createId('link') : undefined
  let document = args.document
  const clipIds: string[] = []

  for (const role of roles) {
    const result = addClipFromMedia({
      document,
      mediaSourceId: args.mediaSourceId,
      role,
      timelineStartMs,
      linkGroupId,
    })
    if (!result.ok) return result
    document = result.document
    if (result.clipId) clipIds.push(result.clipId)
  }

  return {
    ok: true,
    document,
    clipId: clipIds[0],
    clipIds,
  }
}

export function unlinkClip(
  document: ProjectDocument,
  clipId: string,
): OperationResult {
  const group = getLinkedClips(document, clipId)
  if (group.length <= 1) {
    const clip = getClipById(document, clipId)
    if (!clip) return { ok: false, error: 'Clip not found.' }
    if (!clip.linkGroupId) return { ok: true, document }
    return {
      ok: true,
      document: replaceClip(document, { ...clip, linkGroupId: undefined }),
    }
  }

  return {
    ok: true,
    document: replaceClips(
      document,
      group.map((clip) => ({ ...clip, linkGroupId: undefined })),
    ),
  }
}

/**
 * Link a clip to its natural AV counterpart (same media source, other track kind)
 * or to another unlinked clip already sharing the same media source.
 */
export function linkClip(
  document: ProjectDocument,
  clipId: string,
): OperationResult {
  const clip = getClipById(document, clipId)
  if (!clip) return { ok: false, error: 'Clip not found.' }

  if (clip.linkGroupId) {
    const group = getLinkedClips(document, clipId)
    if (group.length > 1) {
      return { ok: false, error: 'Clip is already linked.' }
    }
  }

  const clipTrack = getTrackById(document, clip.trackId)
  if (!clipTrack) return { ok: false, error: 'Clip track not found.' }

  const partner = document.clips.find((candidate) => {
    if (candidate.id === clip.id) return false
    if (candidate.mediaSourceId !== clip.mediaSourceId) return false
    if (candidate.linkGroupId) return false
    const track = getTrackById(document, candidate.trackId)
    return track != null && track.kind !== clipTrack.kind
  })

  if (!partner) {
    return {
      ok: false,
      error: 'No unlinked audio/video pair found for this clip.',
    }
  }

  const linkGroupId = createId('link')
  return {
    ok: true,
    document: replaceClips(document, [
      { ...clip, linkGroupId },
      { ...partner, linkGroupId },
    ]),
  }
}

export function deleteClip(
  document: ProjectDocument,
  clipId: string,
): OperationResult {
  const clip = getClipById(document, clipId)
  if (!clip) {
    return { ok: false, error: 'Clip not found.' }
  }

  // Removing one clip leaves partners behind, unlinked.
  let nextDocument = document
  if (clip.linkGroupId) {
    const unlinkResult = unlinkClip(document, clipId)
    if (!unlinkResult.ok) return unlinkResult
    nextDocument = unlinkResult.document
  }

  return {
    ok: true,
    document: touchDocument({
      ...nextDocument,
      clips: nextDocument.clips.filter((item) => item.id !== clipId),
    }),
  }
}

export function createTrack(args: {
  document: ProjectDocument
  kind: Track['kind']
  order: number
  name: string
}): OperationResult {
  const track: Track = {
    id: createId('track'),
    kind: args.kind,
    order: args.order,
    name: args.name,
    muted: false,
    locked: false,
  }
  return {
    ok: true,
    document: touchDocument({
      ...args.document,
      tracks: [...args.document.tracks, track],
    }),
  }
}

function rangesOverlap(
  startMs: TimeMs,
  durationMs: TimeMs,
  candidate: Clip,
): boolean {
  const endMs = startMs + durationMs
  const candidateEndMs =
    candidate.timelineStartMs + (candidate.sourceOutMs - candidate.sourceInMs)
  return startMs < candidateEndMs && endMs > candidate.timelineStartMs
}

function trackIsFreeAt(args: {
  tracks: Track[]
  clips: Clip[]
  trackId: string
  startMs: TimeMs
  durationMs: TimeMs
}): boolean {
  return args.clips
    .filter((candidate) => candidate.trackId === args.trackId)
    .every(
      (candidate) => !rangesOverlap(args.startMs, args.durationMs, candidate),
    )
}

/** Video prefers home lane (highest order = V1); audio prefers lowest order (A1). */
function sortTracksHomeFirst(tracks: Track[], kind: Track['kind']): Track[] {
  return tracks
    .filter((track) => track.kind === kind && !track.locked)
    .sort((a, b) =>
      kind === 'video' ? b.order - a.order : a.order - b.order,
    )
}

function nextTrackName(tracks: Track[], kind: Track['kind']): string {
  const count = tracks.filter((track) => track.kind === kind).length
  return `${kind === 'video' ? 'Video' : 'Audio'} ${count + 1}`
}

function createProvisionalTrack(
  tracks: Track[],
  kind: Track['kind'],
): { tracks: Track[]; track: Track } {
  const kindTracks = tracks.filter((track) => track.kind === kind)
  const orders = kindTracks.map((track) => track.order)
  const order =
    kind === 'video'
      ? (orders.length > 0 ? Math.min(...orders) : 0) - 1
      : (orders.length > 0 ? Math.max(...orders) : 0) + 1

  const track: Track = {
    id: createId('track'),
    kind,
    order,
    name: nextTrackName(tracks, kind),
    muted: false,
    locked: false,
  }

  return { tracks: [...tracks, track], track }
}

/**
 * Prefer an explicit drop target when free; otherwise the home-most free lane
 * (so clips can return to Video 1 / Audio 1). Create a new lane only when needed.
 */
function resolveTrackWithoutOverlap(args: {
  tracks: Track[]
  occupiedClips: Clip[]
  kind: Track['kind']
  startMs: TimeMs
  durationMs: TimeMs
  preferredTrackId?: string
  documentTrackIds: ReadonlySet<string>
}): { tracks: Track[]; trackId: string } {
  const isFree = (trackId: string) =>
    trackIsFreeAt({
      tracks: args.tracks,
      clips: args.occupiedClips,
      trackId,
      startMs: args.startMs,
      durationMs: args.durationMs,
    })

  if (args.preferredTrackId) {
    const preferred = args.tracks.find(
      (track) =>
        track.id === args.preferredTrackId &&
        track.kind === args.kind &&
        !track.locked,
    )
    if (preferred && isFree(preferred.id)) {
      return { tracks: args.tracks, trackId: preferred.id }
    }
  }

  const homeFree = sortTracksHomeFirst(args.tracks, args.kind).find((track) =>
    isFree(track.id),
  )
  if (homeFree) {
    return { tracks: args.tracks, trackId: homeFree.id }
  }

  // Reuse a seeded provisional lane of this kind before minting a new id.
  const spareProvisional = args.tracks.find(
    (track) =>
      track.kind === args.kind &&
      !track.locked &&
      !args.documentTrackIds.has(track.id) &&
      isFree(track.id),
  )
  if (spareProvisional) {
    return { tracks: args.tracks, trackId: spareProvisional.id }
  }

  const created = createProvisionalTrack(args.tracks, args.kind)
  return { tracks: created.tracks, trackId: created.track.id }
}

function snapStartMsOnTrack(
  clips: Clip[],
  trackId: string,
  clip: Clip,
  startMs: TimeMs,
): TimeMs {
  const durationMs = clip.sourceOutMs - clip.sourceInMs
  const snapDistanceMs = 180
  let nearest = startMs
  let nearestDistance = snapDistanceMs + 1

  for (const candidate of clips) {
    if (candidate.trackId !== trackId) continue
    const candidateEndMs =
      candidate.timelineStartMs +
      (candidate.sourceOutMs - candidate.sourceInMs)
    for (const point of [
      candidateEndMs,
      candidate.timelineStartMs - durationMs,
    ]) {
      const distance = Math.abs(startMs - point)
      if (distance < nearestDistance) {
        nearest = Math.max(0, point)
        nearestDistance = distance
      }
    }
  }

  return nearest
}

export type ClipMovePlacement = {
  clipId: string
  trackId: string
  timelineStartMs: TimeMs
}

export type ClipMovePlan = {
  placements: ClipMovePlacement[]
  tracks: Track[]
}

/**
 * Preview/commit plan for moving a clip (and linked partners) with no overlaps.
 * Video collision → free / new lane above; audio → free / new lane below.
 * When a home lane is free again, placements fold back to Video 1 / Audio 1.
 */
export function planClipMove(args: {
  document: ProjectDocument
  clipId: string
  timelineStartMs: TimeMs
  /** Preferred lane for the primary clip (vertical drop target). */
  trackId?: string
  /** Reuse provisional tracks from a prior live-drag plan (stable ids). */
  seedTracks?: Track[]
}): ClipMovePlan | { error: string } {
  const clip = getClipById(args.document, args.clipId)
  if (!clip) {
    return { error: 'Clip not found.' }
  }

  const linked = getLinkedClips(args.document, args.clipId)
  // Linked AV partners always move together in time; trackId is only a
  // preferred drop lane for the primary clip.
  const movingLinkedGroup = linked.length > 1
  const targets = (movingLinkedGroup ? linked : [clip])
    .slice()
    .sort((a, b) => {
      const aKind = getTrackById(args.document, a.trackId)?.kind
      const bKind = getTrackById(args.document, b.trackId)?.kind
      if (aKind === bKind) return 0
      if (aKind === 'video') return -1
      if (bKind === 'video') return 1
      return 0
    })

  const movingIds = new Set(targets.map((item) => item.id))
  const deltaMs = Math.round(args.timelineStartMs) - clip.timelineStartMs
  const documentTrackIds = new Set(args.document.tracks.map((track) => track.id))

  let tracks = [...args.document.tracks]
  if (args.seedTracks) {
    for (const seeded of args.seedTracks) {
      if (!tracks.some((track) => track.id === seeded.id)) {
        tracks.push(seeded)
      }
    }
  }

  let occupiedClips = args.document.clips.filter(
    (item) => !movingIds.has(item.id),
  )
  const placements: ClipMovePlacement[] = []

  for (const target of targets) {
    const targetTrack = getTrackById(args.document, target.trackId)
    if (!targetTrack) {
      return { error: 'Clip track not found.' }
    }

    let nextStartMs =
      target.id === args.clipId
        ? Math.max(0, Math.round(args.timelineStartMs))
        : Math.max(0, target.timelineStartMs + deltaMs)

    const preferredTrackId =
      target.id === args.clipId ? args.trackId : undefined

    if (!movingLinkedGroup && preferredTrackId) {
      nextStartMs = snapStartMsOnTrack(
        occupiedClips,
        preferredTrackId,
        target,
        nextStartMs,
      )
    } else if (!movingLinkedGroup) {
      const home = sortTracksHomeFirst(tracks, targetTrack.kind)[0]
      if (home) {
        nextStartMs = snapStartMsOnTrack(
          occupiedClips,
          home.id,
          target,
          nextStartMs,
        )
      }
    }

    const durationMs = target.sourceOutMs - target.sourceInMs
    const resolved = resolveTrackWithoutOverlap({
      tracks,
      occupiedClips,
      kind: targetTrack.kind,
      startMs: nextStartMs,
      durationMs,
      preferredTrackId,
      documentTrackIds,
    })

    tracks = resolved.tracks

    if (
      !movingLinkedGroup &&
      preferredTrackId &&
      resolved.trackId !== preferredTrackId
    ) {
      nextStartMs =
        target.id === args.clipId
          ? Math.max(0, Math.round(args.timelineStartMs))
          : Math.max(0, target.timelineStartMs + deltaMs)
    }

    placements.push({
      clipId: target.id,
      trackId: resolved.trackId,
      timelineStartMs: nextStartMs,
    })

    occupiedClips = [
      ...occupiedClips,
      {
        ...target,
        trackId: resolved.trackId,
        timelineStartMs: nextStartMs,
      },
    ]
  }

  // Drop unused provisional lanes from the seed so empty preview rows collapse
  // as soon as clips can sit on home tracks again.
  const usedTrackIds = new Set(placements.map((placement) => placement.trackId))
  for (const item of args.document.clips) {
    if (!movingIds.has(item.id)) usedTrackIds.add(item.trackId)
  }
  tracks = tracks.filter(
    (track) => documentTrackIds.has(track.id) || usedTrackIds.has(track.id),
  )

  return { placements, tracks }
}

/** Drop empty extra video/audio lanes after clips fold back home. */
export function pruneEmptyTracks(document: ProjectDocument): ProjectDocument {
  const used = new Set(document.clips.map((clip) => clip.trackId))
  const videoTracks = document.tracks
    .filter((track) => track.kind === 'video')
    .sort((a, b) => b.order - a.order)
  const audioTracks = document.tracks
    .filter((track) => track.kind === 'audio')
    .sort((a, b) => a.order - b.order)

  const keep = new Set<string>()
  const homeVideo = videoTracks[0]
  const homeAudio = audioTracks[0]
  if (homeVideo) keep.add(homeVideo.id)
  if (homeAudio) keep.add(homeAudio.id)

  for (const track of document.tracks) {
    if (used.has(track.id)) keep.add(track.id)
  }

  const nextTracks = document.tracks.filter((track) => keep.has(track.id))
  if (nextTracks.length === document.tracks.length) return document

  return touchDocument({
    ...document,
    tracks: nextTracks,
  })
}

export function applyClipMovePlan(
  document: ProjectDocument,
  plan: ClipMovePlan,
): OperationResult {
  let next = document

  for (const track of plan.tracks) {
    if (!next.tracks.some((item) => item.id === track.id)) {
      next = touchDocument({
        ...next,
        tracks: [...next.tracks, track],
      })
    }
  }

  for (const placement of plan.placements) {
    const result = moveClip({
      document: next,
      clipId: placement.clipId,
      timelineStartMs: placement.timelineStartMs,
      trackId: placement.trackId,
    })
    if (!result.ok) return result
    next = result.document
  }

  return { ok: true, document: pruneEmptyTracks(next) }
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

  const currentTrack = getTrackById(args.document, clip.trackId)
  const placementKind = currentTrack?.kind
  if (!placementKind) {
    return { ok: false, error: 'Clip track not found.' }
  }

  if (track.kind !== placementKind) {
    return {
      ok: false,
      error: `Cannot move a ${placementKind} clip onto a ${track.kind} track.`,
    }
  }

  if (placementKind === 'video' && !source.hasVideo) {
    return { ok: false, error: 'This media has no video stream.' }
  }
  if (placementKind === 'audio' && !source.hasAudio) {
    return { ok: false, error: 'This media has no audio stream.' }
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

/**
 * Move a clip (and linked AV partners) without allowing overlaps.
 * Colliding video clips promote to a free / new video lane above;
 * colliding audio clips demote to a free / new audio lane below.
 */
export function moveClipOnTimeline(args: {
  document: ProjectDocument
  clipId: string
  timelineStartMs: TimeMs
  trackId?: string
}): OperationResult {
  const plan = planClipMove(args)
  if ('error' in plan) {
    return { ok: false, error: plan.error }
  }
  return applyClipMovePlan(args.document, plan)
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
