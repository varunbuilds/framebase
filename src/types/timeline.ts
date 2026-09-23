/** Canonical timeline time unit: integer milliseconds. */
export type TimeMs = number

export type MediaKind = 'video' | 'audio'

export type TrackKind = 'video' | 'audio'

export type MediaAvailability = 'ready' | 'missing' | 'loading' | 'error'

/** Persistent media reference. Bytes and object URLs live outside this model. */
export interface MediaSource {
  id: string
  name: string
  kind: MediaKind
  durationMs: TimeMs
  mimeType: string
  width?: number
  height?: number
  sampleRate?: number
  channelCount?: number
  /** Paired audio/video source from the same imported file, when available. */
  linkedMediaSourceId?: string
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
 * A timeline instance of a media source.
 * `sourceInMs` / `sourceOutMs` are relative to the source.
 * `timelineStartMs` is the placement on the sequence.
 */
export interface Clip {
  id: string
  mediaSourceId: string
  trackId: string
  timelineStartMs: TimeMs
  sourceInMs: TimeMs
  sourceOutMs: TimeMs
  label?: string
}

export interface ProjectDocument {
  id: string
  name: string
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
