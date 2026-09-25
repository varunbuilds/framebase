import type {
  CanvasAspectRatio,
  Clip,
  MediaAvailability,
  MediaKind,
  MediaLocator,
  MediaSource,
  ProjectCanvas,
  ProjectDocument,
  Track,
  TrackKind,
} from '@/types/timeline'
import { createId } from '@/utils/id'

export function createDefaultTracks(): Track[] {
  return [
    {
      id: createId('track'),
      name: 'Video 1',
      kind: 'video',
      order: 0,
      muted: false,
      locked: false,
    },
    {
      id: createId('track'),
      name: 'Audio 1',
      kind: 'audio',
      order: 1,
      muted: false,
      locked: false,
    },
  ]
}

export function createEmptyProject(
  name = 'Untitled Project',
  id = createId('project'),
  aspectRatio: CanvasAspectRatio = '16:9',
): ProjectDocument {
  const now = new Date().toISOString()
  return {
    id,
    name,
    canvas: { aspectRatio },
    tracks: createDefaultTracks(),
    clips: [],
    mediaSources: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** Store placeholder. Not a created project and never persisted. */
export const unloadedProject: ProjectDocument = {
  id: 'unloaded',
  name: 'Untitled Project',
  canvas: { aspectRatio: '16:9' },
  tracks: [],
  clips: [],
  mediaSources: [],
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
}

export function touchDocument(document: ProjectDocument): ProjectDocument {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
  }
}

/** Compare timeline content without the save clock. */
export function projectContentEqual(
  a: ProjectDocument,
  b: ProjectDocument,
): boolean {
  return (
    JSON.stringify(withoutUpdatedAt(a)) === JSON.stringify(withoutUpdatedAt(b))
  )
}

function withoutUpdatedAt(
  document: ProjectDocument,
): Omit<ProjectDocument, 'updatedAt'> {
  return {
    id: document.id,
    name: document.name,
    canvas: document.canvas,
    tracks: document.tracks,
    clips: document.clips,
    mediaSources: document.mediaSources,
    createdAt: document.createdAt,
  }
}

export function getTrackById(
  document: ProjectDocument,
  trackId: string,
): Track | undefined {
  return document.tracks.find((track) => track.id === trackId)
}

export function getClipById(
  document: ProjectDocument,
  clipId: string,
): Clip | undefined {
  return document.clips.find((clip) => clip.id === clipId)
}

export function getMediaSourceById(
  document: ProjectDocument,
  mediaSourceId: string,
): MediaSource | undefined {
  return document.mediaSources.find((source) => source.id === mediaSourceId)
}

export function getClipsForTrack(
  document: ProjectDocument,
  trackId: string,
): Clip[] {
  return document.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs)
}

/** End time of the last clip on a track (0 when empty). */
export function getTrackContentEndMs(
  document: ProjectDocument,
  trackId: string,
): number {
  return getClipsForTrack(document, trackId).reduce((max, clip) => {
    const end = clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs)
    return Math.max(max, end)
  }, 0)
}

export function getLinkedClips(
  document: ProjectDocument,
  clipId: string,
): Clip[] {
  const clip = getClipById(document, clipId)
  if (!clip?.linkGroupId) return clip ? [clip] : []
  return document.clips.filter((item) => item.linkGroupId === clip.linkGroupId)
}

export function getSortedTracks(document: ProjectDocument): Track[] {
  return [...document.tracks].sort((a, b) => a.order - b.order)
}

export function getTimelineDurationMs(document: ProjectDocument): number {
  if (document.clips.length === 0) return 10_000
  const end = document.clips.reduce((max, clip) => {
    const clipEnd = clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs)
    return Math.max(max, clipEnd)
  }, 0)
  return Math.max(10_000, end + 2_000)
}

export function serializeProject(document: ProjectDocument): string {
  return JSON.stringify(
    {
      version: 1 as const,
      document: toSerializableDocument(document),
    },
    null,
    2,
  )
}

export function deserializeProject(json: string): ProjectDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid project JSON')
  }
  return validateSerializableProject(parsed)
}

function toSerializableDocument(document: ProjectDocument): ProjectDocument {
  return {
    id: document.id,
    name: document.name,
    canvas: { aspectRatio: document.canvas.aspectRatio },
    tracks: document.tracks.map(toSerializableTrack),
    clips: document.clips.map(toSerializableClip),
    mediaSources: document.mediaSources.map(toSerializableMedia),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function toSerializableTrack(track: Track): Track {
  return {
    id: track.id,
    name: track.name,
    kind: track.kind,
    order: track.order,
    muted: track.muted,
    locked: track.locked,
  }
}

function toSerializableClip(clip: Clip): Clip {
  const next: Clip = {
    id: clip.id,
    mediaSourceId: clip.mediaSourceId,
    trackId: clip.trackId,
    timelineStartMs: clip.timelineStartMs,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs,
  }
  if (clip.linkGroupId) next.linkGroupId = clip.linkGroupId
  if (clip.label != null) next.label = clip.label
  return next
}

function toSerializableMedia(source: MediaSource): MediaSource {
  const next: MediaSource = {
    id: source.id,
    name: source.name,
    kind: source.kind,
    hasVideo: source.hasVideo,
    hasAudio: source.hasAudio,
    durationMs: source.durationMs,
    mimeType: source.mimeType,
    locator: { ...source.locator },
    availability: source.availability,
    importedAt: source.importedAt,
  }
  if (source.width != null) next.width = source.width
  if (source.height != null) next.height = source.height
  if (source.sampleRate != null) next.sampleRate = source.sampleRate
  if (source.channelCount != null) next.channelCount = source.channelCount
  return next
}

function validateSerializableProject(parsed: unknown): ProjectDocument {
  const record = asRecord(parsed, 'Invalid project JSON')
  if (record.version !== 1) throw new Error('Unsupported project version')
  const document = asRecord(record.document, 'Invalid project document')

  const id = requiredString(document.id, 'project id')
  const name = requiredString(document.name, 'project name')
  const createdAt = requiredString(document.createdAt, 'createdAt')
  const updatedAt = requiredString(document.updatedAt, 'updatedAt')
  const tracks = requiredArray(document.tracks, 'tracks').map(validateTrack)
  const mediaSources = requiredArray(document.mediaSources, 'media sources').map(
    validateMediaSource,
  )
  const clips = requiredArray(document.clips, 'clips').map(validateClip)

  const trackIds = new Set<string>()
  for (const track of tracks) {
    if (trackIds.has(track.id)) throw new Error(`Duplicate track id "${track.id}"`)
    trackIds.add(track.id)
  }
  const mediaIds = new Set<string>()
  for (const source of mediaSources) {
    if (mediaIds.has(source.id)) {
      throw new Error(`Duplicate media source id "${source.id}"`)
    }
    mediaIds.add(source.id)
  }
  const clipIds = new Set<string>()
  for (const clip of clips) {
    if (clipIds.has(clip.id)) throw new Error(`Duplicate clip id "${clip.id}"`)
    clipIds.add(clip.id)
    if (!trackIds.has(clip.trackId)) {
      throw new Error(`Clip "${clip.id}" references a missing track`)
    }
    if (!mediaIds.has(clip.mediaSourceId)) {
      throw new Error(`Clip "${clip.id}" references a missing media source`)
    }
  }

  return {
    id,
    name,
    canvas: validateCanvas(document.canvas),
    tracks,
    clips,
    mediaSources,
    createdAt,
    updatedAt,
  }
}

function validateCanvas(value: unknown): ProjectCanvas {
  if (value == null) return { aspectRatio: '16:9' }
  const canvas = asRecord(value, 'Invalid canvas')
  const aspectRatio = canvas.aspectRatio
  if (!isCanvasAspectRatio(aspectRatio)) {
    throw new Error('Invalid canvas aspect ratio')
  }
  return { aspectRatio }
}

function isCanvasAspectRatio(value: unknown): value is CanvasAspectRatio {
  return value === '16:9' || value === '9:16' || value === '1:1' || value === '4:3'
}

function validateTrack(value: unknown): Track {
  const track = asRecord(value, 'Invalid track')
  const kind = track.kind
  if (kind !== 'video' && kind !== 'audio') throw new Error('Invalid track kind')
  return {
    id: requiredString(track.id, 'track id'),
    name: requiredString(track.name, 'track name'),
    kind: kind as TrackKind,
    order: requiredNumber(track.order, 'track order'),
    muted: requiredBoolean(track.muted, 'track muted'),
    locked: requiredBoolean(track.locked, 'track locked'),
  }
}

function validateClip(value: unknown): Clip {
  const clip = asRecord(value, 'Invalid clip')
  const sourceInMs = requiredNumber(clip.sourceInMs, 'sourceInMs')
  const sourceOutMs = requiredNumber(clip.sourceOutMs, 'sourceOutMs')
  const timelineStartMs = requiredNumber(clip.timelineStartMs, 'timelineStartMs')
  if (sourceInMs < 0 || sourceOutMs < sourceInMs || timelineStartMs < 0) {
    throw new Error('Invalid clip times')
  }
  const next: Clip = {
    id: requiredString(clip.id, 'clip id'),
    mediaSourceId: requiredString(clip.mediaSourceId, 'clip media source'),
    trackId: requiredString(clip.trackId, 'clip track'),
    timelineStartMs,
    sourceInMs,
    sourceOutMs,
  }
  if (clip.linkGroupId != null) {
    next.linkGroupId = requiredString(clip.linkGroupId, 'link group id')
  }
  if (clip.label != null) {
    if (typeof clip.label !== 'string') throw new Error('Invalid clip label')
    next.label = clip.label
  }
  return next
}

function validateMediaSource(value: unknown): MediaSource {
  const source = asRecord(value, 'Invalid media source')
  const kind = source.kind
  if (kind !== 'video' && kind !== 'audio') {
    throw new Error('Invalid media kind')
  }
  const availability = source.availability
  if (!isAvailability(availability)) throw new Error('Invalid media availability')
  const next: MediaSource = {
    id: requiredString(source.id, 'media id'),
    name: requiredString(source.name, 'media name'),
    kind: kind as MediaKind,
    hasVideo: requiredBoolean(source.hasVideo, 'hasVideo'),
    hasAudio: requiredBoolean(source.hasAudio, 'hasAudio'),
    durationMs: requiredNumber(source.durationMs, 'durationMs'),
    mimeType: requiredString(source.mimeType, 'mimeType'),
    locator: validateLocator(source.locator),
    availability,
    importedAt: requiredString(source.importedAt, 'importedAt'),
  }
  if (next.durationMs < 0) throw new Error('Invalid media duration')
  if (source.width != null) next.width = requiredNumber(source.width, 'width')
  if (source.height != null) next.height = requiredNumber(source.height, 'height')
  if (source.sampleRate != null) {
    next.sampleRate = requiredNumber(source.sampleRate, 'sampleRate')
  }
  if (source.channelCount != null) {
    next.channelCount = requiredNumber(source.channelCount, 'channelCount')
  }
  return next
}

function validateLocator(value: unknown): MediaLocator {
  const locator = asRecord(value, 'Invalid media locator')
  if (locator.kind === 'runtime') return { kind: 'runtime' }
  if (
    locator.kind === 'local' ||
    locator.kind === 'opfs' ||
    locator.kind === 'remote'
  ) {
    return {
      kind: locator.kind,
      key: requiredString(locator.key, 'media locator key'),
    }
  }
  throw new Error('Invalid media locator')
}

function isAvailability(value: unknown): value is MediaAvailability {
  return (
    value === 'known' ||
    value === 'available' ||
    value === 'missing' ||
    value === 'loading' ||
    value === 'error'
  )
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`)
  return value
}
