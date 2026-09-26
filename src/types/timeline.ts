/** Canonical timeline time unit: integer milliseconds. */
export type TimeMs = number

export type MediaKind = 'video' | 'audio'

export const CANVAS_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3'] as const

export type CanvasAspectRatio = (typeof CANVAS_ASPECT_RATIOS)[number]

/** Persistent preview frame. Not a rendered pixel buffer. */
export interface ProjectCanvas {
  aspectRatio: CanvasAspectRatio
}

export type TrackKind = 'video' | 'audio'

/**
 * Document-level media status. This is not a proof that bytes still exist.
 * `available` means a runtime resource was attached for this session.
 * `known` means the identity is recorded and bytes are not attached.
 */
export type MediaAvailability =
  | 'known'
  | 'available'
  | 'missing'
  | 'loading'
  | 'error'

/**
 * Durable pointer to media bytes. The runtime object URL, File, and media
 * element are never stored here. `local` is a mediaSourceId in the
 * user-selected workspace. `opfs` is a legacy id in browser storage.
 * Neither means another device has the bytes. `runtime` exists only for
 * this page session.
 */
export type MediaLocator =
  | { kind: 'runtime' }
  | { kind: 'local'; key: string }
  | { kind: 'opfs'; key: string }
  | { kind: 'remote'; key: string }

/** Persistent media reference. Bytes and object URLs live outside this model. */
export interface MediaSource {
  id: string
  name: string
  /** Primary library kind (video if the file has a video stream, else audio). */
  kind: MediaKind
  /** Whether the file contains a video stream. */
  hasVideo: boolean
  /** Whether the file contains an audio stream. */
  hasAudio: boolean
  durationMs: TimeMs
  mimeType: string
  width?: number
  height?: number
  sampleRate?: number
  channelCount?: number
  /** Where durable or session bytes are addressed. Not a blob URL. */
  locator: MediaLocator
  availability: MediaAvailability
  importedAt: string
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  order: number
  muted: boolean
  locked: boolean
}

/**
 * An AV file is one MediaSource in the library; placing it may create both a
 * video-track clip and an audio-track clip that share a linkGroupId so they
 * move together until unlinked. Users can also link any video clip to any
 * audio clip via selection.
 */
export interface Clip {
  id: string
  mediaSourceId: string
  trackId: string
  timelineStartMs: TimeMs
  sourceInMs: TimeMs
  sourceOutMs: TimeMs
  /** Shared id for linked clip groups (move/trim together until unlinked). */
  linkGroupId?: string
  label?: string
}

export interface ProjectDocument {
  id: string
  name: string
  canvas: ProjectCanvas
  tracks: Track[]
  clips: Clip[]
  mediaSources: MediaSource[]
  createdAt: string
  updatedAt: string
}

export interface SerializableProject {
  version: 1
  document: ProjectDocument
}
