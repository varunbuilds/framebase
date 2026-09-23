import type { Clip, ProjectDocument, TimeMs } from './timeline'

export interface EditorUiState {
  selectedClipIds: string[]
  selectedMediaSourceId: string | null
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
  /** Local-only save indicator — not remote sync. */
  saveStatus: 'unsaved' | 'saved'
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
