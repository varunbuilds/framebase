import { create, type StateCreator } from 'zustand'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import {
  addClipFromMedia,
  addMediaSource,
  deleteClip,
  moveClip,
  removeMediaSource,
  renameProject,
  trimClip,
  updateClipLabel,
} from '@/features/editor/operations'
import { createEmptyProject } from '@/features/editor/project'
import { revokeObjectUrl } from '@/lib/media/object-urls'
import type { ClipDragState, EditorUiState } from '@/types/editor'
import type { MediaSource, ProjectDocument, TimeMs } from '@/types/timeline'
import { clamp } from '@/utils/time'

interface EditorActions {
  setProjectName: (name: string) => void
  markSaved: () => void
  selectClip: (clipId: string | null) => void
  selectMediaSource: (mediaSourceId: string | null) => void
  setPlayheadMs: (ms: TimeMs) => void
  setIsPlaying: (playing: boolean) => void
  setPixelsPerSecond: (pps: number) => void
  setTimelineScrollLeft: (left: number) => void
  setImportError: (error: string | null) => void
  setImportStatus: (status: EditorUiState['importStatus']) => void
  setClipDrag: (drag: ClipDragState | null) => void
  registerMediaSource: (source: MediaSource) => boolean
  unregisterMediaSource: (mediaSourceId: string) => boolean
  addClip: (mediaSourceId: string, timelineStartMs?: TimeMs) => boolean
  removeClip: (clipId: string) => boolean
  moveClipTo: (clipId: string, timelineStartMs: TimeMs, trackId?: string) => boolean
  trimClipTo: (
    clipId: string,
    args: {
      sourceInMs?: TimeMs
      sourceOutMs?: TimeMs
      timelineStartMs?: TimeMs
    },
  ) => boolean
  updateSelectedClipLabel: (label: string) => boolean
}

export type EditorStore = {
  document: ProjectDocument
  ui: EditorUiState
  clipDrag: ClipDragState | null
} & EditorActions

const initialUi: EditorUiState = {
  selectedClipId: null,
  selectedMediaSourceId: null,
  playheadMs: 0,
  isPlaying: false,
  pixelsPerSecond: 80,
  timelineScrollLeft: 0,
  importError: null,
  importStatus: 'idle',
  saveStatus: 'unsaved',
  lastSavedAt: null,
}

function documentsEqual(a: ProjectDocument, b: ProjectDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const editorStoreCreator: StateCreator<EditorStore> = (set, get) => ({
  document: createEmptyProject('Untitled Project'),
  ui: initialUi,
  clipDrag: null,

  setProjectName: (name) => {
    const result = renameProject(get().document, name)
    if (!result.ok) return
    set({
      document: result.document,
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
  },

  markSaved: () => {
    set({
      ui: {
        ...get().ui,
        saveStatus: 'saved',
        lastSavedAt: new Date().toISOString(),
      },
    })
  },

  selectClip: (clipId) => {
    set({
      ui: {
        ...get().ui,
        selectedClipId: clipId,
        isPlaying: false,
      },
    })
  },

  selectMediaSource: (mediaSourceId) => {
    set({
      ui: {
        ...get().ui,
        selectedMediaSourceId: mediaSourceId,
      },
    })
  },

  setPlayheadMs: (ms) => {
    set({
      ui: { ...get().ui, playheadMs: Math.max(0, Math.round(ms)) },
    })
  },

  setIsPlaying: (playing) => {
    set({
      ui: { ...get().ui, isPlaying: playing },
    })
  },

  setPixelsPerSecond: (pps) => {
    set({
      ui: {
        ...get().ui,
        pixelsPerSecond: clamp(pps, 20, 240),
      },
    })
  },

  setTimelineScrollLeft: (left) => {
    set({
      ui: { ...get().ui, timelineScrollLeft: Math.max(0, left) },
    })
  },

  setImportError: (error) => {
    set({
      ui: { ...get().ui, importError: error },
    })
  },

  setImportStatus: (status) => {
    set({
      ui: { ...get().ui, importStatus: status },
    })
  },

  setClipDrag: (drag) => {
    set({ clipDrag: drag })
  },

  registerMediaSource: (source) => {
    const temporal = useEditorStore.temporal.getState()
    temporal.pause()
    const result = addMediaSource(get().document, source)
    if (!result.ok) {
      temporal.resume()
      get().setImportError(result.error)
      return false
    }
    set({
      document: result.document,
      ui: {
        ...get().ui,
        selectedMediaSourceId: source.id,
        importError: null,
        saveStatus: 'unsaved',
      },
    })
    temporal.resume()
    return true
  },

  unregisterMediaSource: (mediaSourceId) => {
    const temporal = useEditorStore.temporal.getState()
    temporal.pause()
    const result = removeMediaSource(get().document, mediaSourceId)
    if (!result.ok) {
      temporal.resume()
      return false
    }
    revokeObjectUrl(mediaSourceId)
    const ui = get().ui
    set({
      document: result.document,
      ui: {
        ...ui,
        selectedMediaSourceId:
          ui.selectedMediaSourceId === mediaSourceId
            ? null
            : ui.selectedMediaSourceId,
        selectedClipId: result.document.clips.some((clip) => clip.id === ui.selectedClipId)
          ? ui.selectedClipId
          : null,
        saveStatus: 'unsaved',
      },
    })
    temporal.resume()
    return true
  },

  addClip: (mediaSourceId, timelineStartMs) => {
    const result = addClipFromMedia({
      document: get().document,
      mediaSourceId,
      timelineStartMs: timelineStartMs ?? get().ui.playheadMs,
    })
    if (!result.ok) {
      get().setImportError(result.error)
      return false
    }
    set({
      document: result.document,
      ui: {
        ...get().ui,
        selectedClipId: result.clipId ?? null,
        importError: null,
        saveStatus: 'unsaved',
      },
    })
    return true
  },

  removeClip: (clipId) => {
    const result = deleteClip(get().document, clipId)
    if (!result.ok) return false
    const ui = get().ui
    set({
      document: result.document,
      ui: {
        ...ui,
        selectedClipId: ui.selectedClipId === clipId ? null : ui.selectedClipId,
        isPlaying: false,
        saveStatus: 'unsaved',
      },
    })
    return true
  },

  moveClipTo: (clipId, timelineStartMs, trackId) => {
    const result = moveClip({
      document: get().document,
      clipId,
      timelineStartMs,
      trackId,
    })
    if (!result.ok) return false
    set({
      document: result.document,
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
    return true
  },

  trimClipTo: (clipId, args) => {
    const result = trimClip({
      document: get().document,
      clipId,
      ...args,
    })
    if (!result.ok) return false
    set({
      document: result.document,
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
    return true
  },

  updateSelectedClipLabel: (label) => {
    const clipId = get().ui.selectedClipId
    if (!clipId) return false
    const result = updateClipLabel(get().document, clipId, label)
    if (!result.ok) return false
    set({
      document: result.document,
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
    return true
  },
})

export const useEditorStore = create<EditorStore>()(
  temporal(editorStoreCreator, {
    limit: 100,
    partialize: (state) => ({ document: state.document }),
    equality: (past, current) => documentsEqual(past.document, current.document),
  }),
)

export function useEditorHistory() {
  const undo = useStore(useEditorStore.temporal, (state) => state.undo)
  const redo = useStore(useEditorStore.temporal, (state) => state.redo)
  const canUndo = useStore(
    useEditorStore.temporal,
    (state) => state.pastStates.length > 0,
  )
  const canRedo = useStore(
    useEditorStore.temporal,
    (state) => state.futureStates.length > 0,
  )

  return { undo, redo, canUndo, canRedo }
}
