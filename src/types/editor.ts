import type { Clip, ProjectDocument, TimeMs } from './timeline'

export interface EditorUiState {
  selectedClipIds: string[]
  /** Library selection, in the order items were selected. */
  selectedMediaSourceIds: string[]
  playheadMs: TimeMs
  isPlaying: boolean
  /** Bumped on explicit seeks so the playback loop adopts the new playhead. */
  seekVersion: number
  pixelsPerSecond: number
  timelineScrollLeft: number
  /** Timeline panel height in pixels (transient UI). */
  timelineHeightPx: number
  importError: string | null
  importStatus: 'idle' | 'importing'
  playbackError: string | null
  /** Durable project save status. Playback and UI state are not saved. */
  saveStatus: 'unsaved' | 'saving' | 'saved' | 'error'
  saveError: string | null
  /** Incremented to flush a save immediately. */
  saveRequest: number
  lastSavedAt: string | null
}

export interface ClipDragState {
  clipId: string
  mode: 'move' | 'trim-in' | 'trim-out'
  originClientX: number
  originClientY: number
  originTrackId: string
  originTimelineStartMs: TimeMs
  originSourceInMs: TimeMs
  originSourceOutMs: TimeMs
  linkGroupId?: string
}

export type EditorDocumentSlice = {
  document: ProjectDocument
}

export type SelectedClipView = {
  clip: Clip
  mediaName: string
  mediaKind: 'video' | 'audio'
  durationMs: TimeMs
}
