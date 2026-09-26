import type {
  CanvasAspectRatio,
  MediaKind,
  MediaLocator,
  RemoteMediaReference,
  TrackKind,
} from '@/types/timeline'

/**
 * Field shapes for the Liveblocks Storage tree. Every value is plain JSON, so
 * each entity is one LiveObject whose keys merge independently when two people
 * edit different properties of the same clip.
 *
 * Bump this when the stored shape changes in a way readers must handle.
 */
export const COLLAB_SCHEMA_VERSION = 1

/**
 * Interfaces are not assignable to Liveblocks' Lson index signature, so nested
 * domain records are mapped into structurally identical type aliases.
 */
type Plain<T> = { [K in keyof T]: T[K] }

export type CollabMediaLocator = Plain<MediaLocator>
export type CollabRemoteMediaReference = Plain<RemoteMediaReference>

/** Project-level state. Tracks, clips and media live in their own LiveMaps. */
export type CollabProjectFields = {
  schemaVersion: number
  id: string
  name: string
  canvasAspectRatio: CanvasAspectRatio
  createdAt: string
  updatedAt: string
}

export type CollabTrackFields = {
  id: string
  name: string
  kind: TrackKind
  order: number
  muted: boolean
  locked: boolean
}

export type CollabClipFields = {
  id: string
  mediaSourceId: string
  trackId: string
  timelineStartMs: number
  sourceInMs: number
  sourceOutMs: number
  linkGroupId?: string
  label?: string
}

/**
 * Durable media identity and references only. `availability` is this device's
 * runtime state, and the bytes live in Supabase Storage, the local workspace
 * and OPFS. No Blob, File, ArrayBuffer, frame, filmstrip or waveform data ever
 * enters collaborative storage.
 */
export type CollabMediaSourceFields = {
  id: string
  name: string
  kind: MediaKind
  hasVideo: boolean
  hasAudio: boolean
  durationMs: number
  mimeType: string
  width?: number
  height?: number
  sampleRate?: number
  channelCount?: number
  locator: CollabMediaLocator
  remote?: CollabRemoteMediaReference
  importedAt: string
}
