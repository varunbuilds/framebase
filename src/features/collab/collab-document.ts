import { LiveMap, LiveObject, type LsonObject } from '@liveblocks/client'
import { unloadedProject } from '@/features/editor/project'
import {
  CANVAS_ASPECT_RATIOS,
  type CanvasAspectRatio,
  type Clip,
  type MediaAvailability,
  type MediaKind,
  type MediaLocator,
  type MediaSource,
  type ProjectDocument,
  type RemoteMediaReference,
  type Track,
  type TrackKind,
} from '@/types/timeline'
import {
  COLLAB_SCHEMA_VERSION,
  type CollabClipFields,
  type CollabMediaSourceFields,
  type CollabProjectFields,
  type CollabTrackFields,
} from './collab-schema'

/**
 * The boundary between Framebase's ProjectDocument and Liveblocks Storage.
 *
 * Reading is deliberately forgiving: a room written by an older build, a
 * partially applied edit, or hand-edited storage must degrade into a valid
 * document instead of throwing inside React. Writing is a structural diff so
 * that moving one clip touches one LiveObject field and leaves every other
 * entity untouched, which is what lets Liveblocks merge concurrent edits.
 */

export type CollabStorage = Liveblocks['Storage']
export type CollabRoot = LiveObject<CollabStorage>

/**
 * Every key each entity can hold. Built from a `satisfies Record<keyof …>` so
 * adding a field to the schema without listing it here fails to compile, which
 * is what lets the diff writer clear a key that a new document omits.
 */
function fieldKeys<F>(shape: Record<keyof F, true>): Array<keyof F & string> {
  return Object.keys(shape) as Array<keyof F & string>
}

const PROJECT_KEYS = fieldKeys<CollabProjectFields>({
  schemaVersion: true,
  id: true,
  name: true,
  canvasAspectRatio: true,
  createdAt: true,
  updatedAt: true,
})

const TRACK_KEYS = fieldKeys<CollabTrackFields>({
  id: true,
  name: true,
  kind: true,
  order: true,
  muted: true,
  locked: true,
})

const CLIP_KEYS = fieldKeys<CollabClipFields>({
  id: true,
  mediaSourceId: true,
  trackId: true,
  timelineStartMs: true,
  sourceInMs: true,
  sourceOutMs: true,
  linkGroupId: true,
  label: true,
})

const MEDIA_KEYS = fieldKeys<CollabMediaSourceFields>({
  id: true,
  name: true,
  kind: true,
  hasVideo: true,
  hasAudio: true,
  durationMs: true,
  mimeType: true,
  width: true,
  height: true,
  sampleRate: true,
  channelCount: true,
  locator: true,
  remote: true,
  importedAt: true,
})

export type ReadCollabDocumentOptions = {
  /** Used for id, createdAt and name when storage has not been written yet. */
  fallback?: ProjectDocument
  /** This device's runtime media availability, which is never collaborative. */
  availability?: ReadonlyMap<string, MediaAvailability>
}

export function projectFieldsFrom(document: ProjectDocument): CollabProjectFields {
  return {
    schemaVersion: COLLAB_SCHEMA_VERSION,
    id: document.id,
    name: document.name,
    canvasAspectRatio: document.canvas.aspectRatio,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

export function trackFieldsFrom(track: Track): CollabTrackFields {
  return {
    id: track.id,
    name: track.name,
    kind: track.kind,
    order: track.order,
    muted: track.muted,
    locked: track.locked,
  }
}

export function clipFieldsFrom(clip: Clip): CollabClipFields {
  const fields: CollabClipFields = {
    id: clip.id,
    mediaSourceId: clip.mediaSourceId,
    trackId: clip.trackId,
    timelineStartMs: clip.timelineStartMs,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs,
  }
  if (clip.linkGroupId) fields.linkGroupId = clip.linkGroupId
  if (clip.label != null) fields.label = clip.label
  return fields
}

/** Availability is omitted on purpose: it describes this device, not the room. */
export function mediaSourceFieldsFrom(source: MediaSource): CollabMediaSourceFields {
  const fields: CollabMediaSourceFields = {
    id: source.id,
    name: source.name,
    kind: source.kind,
    hasVideo: source.hasVideo,
    hasAudio: source.hasAudio,
    durationMs: source.durationMs,
    mimeType: source.mimeType,
    locator: canonicalLocator(source.locator),
    importedAt: source.importedAt,
  }
  if (source.width != null) fields.width = source.width
  if (source.height != null) fields.height = source.height
  if (source.sampleRate != null) fields.sampleRate = source.sampleRate
  if (source.channelCount != null) fields.channelCount = source.channelCount
  if (source.remote) fields.remote = canonicalRemote(source.remote)
  return fields
}

/** Seeds a brand new room from the project's existing ProjectDocument. */
export function createCollabStorage(document: ProjectDocument): CollabStorage {
  return {
    project: new LiveObject(projectFieldsFrom(document)),
    tracks: new LiveMap(
      document.tracks.map((track) => [track.id, new LiveObject(trackFieldsFrom(track))]),
    ),
    clips: new LiveMap(
      document.clips.map((clip) => [clip.id, new LiveObject(clipFieldsFrom(clip))]),
    ),
    mediaSources: new LiveMap(
      document.mediaSources.map((source) => [
        source.id,
        new LiveObject(mediaSourceFieldsFrom(source)),
      ]),
    ),
  }
}

/** Never throws. Invalid entries are dropped rather than crashing the editor. */
export function readCollabDocument(
  root: CollabRoot,
  options: ReadCollabDocumentOptions = {},
): ProjectDocument {
  const fallback = options.fallback ?? unloadedProject
  const project = liveObjectOrNull<CollabProjectFields>(safeGet(root, 'project'))

  const id = readString(project && safeGet(project, 'id')) ?? fallback.id
  const name = readString(project && safeGet(project, 'name')) ?? fallback.name
  const createdAt =
    readString(project && safeGet(project, 'createdAt')) ?? fallback.createdAt
  const updatedAt =
    readString(project && safeGet(project, 'updatedAt')) ?? fallback.updatedAt
  const aspectRatio =
    readAspectRatio(project && safeGet(project, 'canvasAspectRatio')) ??
    fallback.canvas.aspectRatio

  const tracks = readTracks(safeGet(root, 'tracks'))
  const mediaSources = readMediaSources(safeGet(root, 'mediaSources'), options.availability)
  const clips = readClips(
    safeGet(root, 'clips'),
    new Set(tracks.map((track) => track.id)),
    new Set(mediaSources.map((source) => source.id)),
  )

  return {
    id,
    name,
    canvas: { aspectRatio },
    tracks,
    clips,
    mediaSources,
    createdAt,
    updatedAt,
  }
}

/**
 * Applies the difference between two documents to storage. `previous` is the
 * last state this client knows storage held; entities missing from it are left
 * alone so a concurrent insert from another client is never deleted.
 *
 * Call inside room.batch() so collaborators observe one coherent change.
 */
export function writeCollabDocument(
  root: CollabRoot,
  previous: ProjectDocument,
  next: ProjectDocument,
): void {
  const project = liveObjectOrNull<CollabProjectFields>(safeGet(root, 'project'))
  const tracks = liveMapOrNull<CollabTrackFields>(safeGet(root, 'tracks'))
  const clips = liveMapOrNull<CollabClipFields>(safeGet(root, 'clips'))
  const mediaSources = liveMapOrNull<CollabMediaSourceFields>(
    safeGet(root, 'mediaSources'),
  )

  if (project) patchLiveObject(project, projectFieldsFrom(next), PROJECT_KEYS)

  // Clips go away before the tracks and media they point at, and arrive after
  // them, so storage never holds a clip with a dangling reference.
  if (clips) removeMissing(clips, previous.clips, next.clips)
  if (tracks) upsertAll(tracks, next.tracks, trackFieldsFrom, TRACK_KEYS)
  if (mediaSources) {
    upsertAll(mediaSources, next.mediaSources, mediaSourceFieldsFrom, MEDIA_KEYS)
  }
  if (clips) {
    const trackIds = new Set(next.tracks.map((track) => track.id))
    const mediaIds = new Set(next.mediaSources.map((source) => source.id))
    upsertAll(
      clips,
      next.clips.filter(
        (clip) => trackIds.has(clip.trackId) && mediaIds.has(clip.mediaSourceId),
      ),
      clipFieldsFrom,
      CLIP_KEYS,
    )
  }
  if (tracks) removeMissing(tracks, previous.tracks, next.tracks)
  if (mediaSources) {
    removeMissing(mediaSources, previous.mediaSources, next.mediaSources)
  }
}

/**
 * Whether storage already holds this document.
 *
 * Compares exactly what would be written: project fields plus each entity keyed
 * by its stable id. Array order, object key order and this device's media
 * availability are deliberately ignored, because none of them are collaborative
 * state and none of them should trigger a write or a re-hydration.
 */
export function collabDocumentEqual(a: ProjectDocument, b: ProjectDocument): boolean {
  return collabSignature(a) === collabSignature(b)
}

function collabSignature(document: ProjectDocument): string {
  return stableJson({
    project: projectFieldsFrom(document),
    tracks: byId(document.tracks.map(trackFieldsFrom)),
    clips: byId(document.clips.map(clipFieldsFrom)),
    mediaSources: byId(document.mediaSources.map(mediaSourceFieldsFrom)),
  })
}

function byId<T extends { id: string }>(entities: T[]): T[] {
  return [...entities].sort((a, b) => compareIds(a.id, b.id))
}

function upsertAll<T extends { id: string }, F extends LsonObject>(
  map: LiveMap<string, LiveObject<F>>,
  entities: readonly T[],
  toFields: (entity: T) => F,
  keys: ReadonlyArray<keyof F & string>,
): void {
  for (const entity of entities) {
    const fields = toFields(entity)
    const existing = liveObjectOrNull<F>(safeGet(map, entity.id))
    if (existing) {
      patchLiveObject(existing, fields, keys)
    } else {
      map.set(entity.id, new LiveObject(fields))
    }
  }
}

function removeMissing<T extends { id: string }, F extends LsonObject>(
  map: LiveMap<string, LiveObject<F>>,
  previous: readonly T[],
  next: readonly T[],
): void {
  const keep = new Set(next.map((entity) => entity.id))
  for (const entity of previous) {
    if (keep.has(entity.id)) continue
    if (map.has(entity.id)) map.delete(entity.id)
  }
}

/**
 * Writes only the keys whose value actually changed, so two clients editing
 * different properties of one entity both keep their change.
 */
function patchLiveObject<F extends LsonObject>(
  target: LiveObject<F>,
  fields: F,
  keys: ReadonlyArray<keyof F & string>,
): void {
  for (const key of keys) {
    const value = fields[key]
    const current = safeGet(target, key)
    if (value === undefined) {
      if (current !== undefined) target.delete(key)
      continue
    }
    if (sameJson(current, value)) continue
    target.set(key, value)
  }
}

/** Reads one key from a Live structure without trusting its shape. */
function safeGet(target: unknown, key: string): unknown {
  if (target == null || typeof target !== 'object') return undefined
  const getter = (target as { get?: unknown }).get
  if (typeof getter !== 'function') return undefined
  try {
    return (getter as (key: string) => unknown).call(target, key)
  } catch {
    return undefined
  }
}

/** Order-independent comparison, so a reordered stored object is not a change. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  return stableJson(a) === stableJson(b)
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
  return `{${entries.join(',')}}`
}

function readTracks(value: unknown): Track[] {
  const map = liveMapOrNull<CollabTrackFields>(value)
  if (!map) return []
  const tracks: Track[] = []
  const seen = new Set<string>()
  for (const entry of safeEntries(map)) {
    const fields = liveObjectOrNull<CollabTrackFields>(entry[1])
    if (!fields) continue
    const id = readString(safeGet(fields, 'id')) ?? entry[0]
    if (!id || seen.has(id)) continue
    const kind = readTrackKind(safeGet(fields, 'kind'))
    if (!kind) continue
    seen.add(id)
    tracks.push({
      id,
      name: readString(safeGet(fields, 'name')) ?? (kind === 'video' ? 'Video' : 'Audio'),
      kind,
      order: readInteger(safeGet(fields, 'order')) ?? tracks.length,
      muted: readBoolean(safeGet(fields, 'muted')) ?? false,
      locked: readBoolean(safeGet(fields, 'locked')) ?? false,
    })
  }
  // Stable under edits: track order is a field, so this only moves on reorder.
  return tracks.sort((a, b) => a.order - b.order || compareIds(a.id, b.id))
}

function readMediaSources(
  value: unknown,
  availability?: ReadonlyMap<string, MediaAvailability>,
): MediaSource[] {
  const map = liveMapOrNull<CollabMediaSourceFields>(value)
  if (!map) return []
  const sources: MediaSource[] = []
  const seen = new Set<string>()
  for (const entry of safeEntries(map)) {
    const fields = liveObjectOrNull<CollabMediaSourceFields>(entry[1])
    if (!fields) continue
    const id = readString(safeGet(fields, 'id')) ?? entry[0]
    if (!id || seen.has(id)) continue
    const kind = readMediaKind(safeGet(fields, 'kind'))
    const locator = readLocator(safeGet(fields, 'locator'))
    const durationMs = readInteger(safeGet(fields, 'durationMs'))
    if (!kind || !locator || durationMs == null || durationMs < 0) continue
    seen.add(id)
    const source: MediaSource = {
      id,
      name: readString(safeGet(fields, 'name')) ?? id,
      kind,
      hasVideo: readBoolean(safeGet(fields, 'hasVideo')) ?? kind === 'video',
      hasAudio: readBoolean(safeGet(fields, 'hasAudio')) ?? kind === 'audio',
      durationMs,
      mimeType: readString(safeGet(fields, 'mimeType')) ?? 'application/octet-stream',
      locator,
      // Bytes are per device, so a freshly read room starts at `known`.
      availability: availability?.get(id) ?? 'known',
      importedAt: readString(safeGet(fields, 'importedAt')) ?? EPOCH,
    }
    const width = readInteger(safeGet(fields, 'width'))
    const height = readInteger(safeGet(fields, 'height'))
    const sampleRate = readInteger(safeGet(fields, 'sampleRate'))
    const channelCount = readInteger(safeGet(fields, 'channelCount'))
    if (width != null) source.width = width
    if (height != null) source.height = height
    if (sampleRate != null) source.sampleRate = sampleRate
    if (channelCount != null) source.channelCount = channelCount
    const remote = readRemote(id, safeGet(fields, 'remote'))
    if (remote) source.remote = remote
    sources.push(source)
  }
  return sources.sort(
    (a, b) =>
      (a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0) ||
      compareIds(a.id, b.id),
  )
}

function readClips(
  value: unknown,
  trackIds: ReadonlySet<string>,
  mediaIds: ReadonlySet<string>,
): Clip[] {
  const map = liveMapOrNull<CollabClipFields>(value)
  if (!map) return []
  const clips: Clip[] = []
  const seen = new Set<string>()
  for (const entry of safeEntries(map)) {
    const fields = liveObjectOrNull<CollabClipFields>(entry[1])
    if (!fields) continue
    const id = readString(safeGet(fields, 'id')) ?? entry[0]
    if (!id || seen.has(id)) continue
    const trackId = readString(safeGet(fields, 'trackId'))
    const mediaSourceId = readString(safeGet(fields, 'mediaSourceId'))
    if (!trackId || !mediaSourceId) continue
    // A clip whose track or media was removed concurrently is dropped, not
    // rendered against a missing reference.
    if (!trackIds.has(trackId) || !mediaIds.has(mediaSourceId)) continue
    const timelineStartMs = readInteger(safeGet(fields, 'timelineStartMs'))
    const sourceInMs = readInteger(safeGet(fields, 'sourceInMs'))
    const sourceOutMs = readInteger(safeGet(fields, 'sourceOutMs'))
    if (timelineStartMs == null || sourceInMs == null || sourceOutMs == null) continue
    if (timelineStartMs < 0 || sourceInMs < 0 || sourceOutMs <= sourceInMs) continue
    seen.add(id)
    const clip: Clip = {
      id,
      mediaSourceId,
      trackId,
      timelineStartMs,
      sourceInMs,
      sourceOutMs,
    }
    const linkGroupId = readString(safeGet(fields, 'linkGroupId'))
    if (linkGroupId) clip.linkGroupId = linkGroupId
    const label = safeGet(fields, 'label')
    if (typeof label === 'string') clip.label = label
    clips.push(clip)
  }
  // Sorted by id so moving or trimming a clip never reshuffles the array.
  return clips.sort((a, b) => compareIds(a.id, b.id))
}

const EPOCH = '1970-01-01T00:00:00.000Z'

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function canonicalLocator(locator: MediaLocator): MediaLocator {
  return locator.kind === 'runtime'
    ? { kind: 'runtime' }
    : { kind: locator.kind, key: locator.key }
}

function canonicalRemote(remote: RemoteMediaReference): RemoteMediaReference {
  return {
    assetId: remote.assetId,
    storagePath: remote.storagePath,
    sizeBytes: remote.sizeBytes,
    uploadedAt: remote.uploadedAt,
  }
}

function readLocator(value: unknown): MediaLocator | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.kind === 'runtime') return { kind: 'runtime' }
  if (record.kind === 'local' || record.kind === 'opfs' || record.kind === 'remote') {
    const key = readString(record.key)
    if (!key) return null
    return { kind: record.kind, key }
  }
  return null
}

/** Mirrors the stored-document rule: a remote reference must match its source. */
function readRemote(
  sourceId: string,
  value: unknown,
): RemoteMediaReference | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const assetId = readString(record.assetId)
  const storagePath = readString(record.storagePath)
  const sizeBytes = readInteger(record.sizeBytes)
  const uploadedAt = readString(record.uploadedAt)
  if (assetId !== sourceId) return undefined
  if (storagePath !== `media/${sourceId}/source`) return undefined
  if (sizeBytes == null || sizeBytes < 0 || !uploadedAt) return undefined
  return { assetId, storagePath, sizeBytes, uploadedAt }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Canonical timeline time is integer milliseconds. */
function readInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value)
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readTrackKind(value: unknown): TrackKind | null {
  return value === 'video' || value === 'audio' ? value : null
}

function readMediaKind(value: unknown): MediaKind | null {
  return value === 'video' || value === 'audio' ? value : null
}

function readAspectRatio(value: unknown): CanvasAspectRatio | null {
  return CANVAS_ASPECT_RATIOS.includes(value as CanvasAspectRatio)
    ? (value as CanvasAspectRatio)
    : null
}

function liveObjectOrNull<F extends LsonObject>(value: unknown): LiveObject<F> | null {
  return value instanceof LiveObject ? (value as LiveObject<F>) : null
}

function liveMapOrNull<F extends LsonObject>(
  value: unknown,
): LiveMap<string, LiveObject<F>> | null {
  return value instanceof LiveMap ? (value as LiveMap<string, LiveObject<F>>) : null
}

function safeEntries<F extends LsonObject>(
  map: LiveMap<string, LiveObject<F>>,
): Array<[string, LiveObject<F>]> {
  try {
    return [...map.entries()]
  } catch {
    return []
  }
}

/** This device's media availability, so a room read does not reset it. */
export function mediaAvailabilityOf(
  document: ProjectDocument,
): Map<string, MediaAvailability> {
  return new Map(document.mediaSources.map((source) => [source.id, source.availability]))
}
