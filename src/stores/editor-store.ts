import { create, type StateCreator } from 'zustand'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import {
  addMediaSource,
  addMediaToTimeline,
  deleteClip,
  linkClips,
  moveClipOnTimeline,
  removeMediaSource,
  renameProject,
  trimClip,
  unlinkClips,
  splitClipsAtTime,
  updateClipLabel,
} from '@/features/editor/operations'
import { getPlaybackEndMs } from '@/features/editor/playback'
import {
  getLinkedClips,
  projectContentEqual,
  touchDocument,
  unloadedProject,
} from '@/features/editor/project'
import { clearFilmstripFramesForObjectUrl } from '@/lib/media/filmstrip-cache'
import { deleteMedia } from '@/lib/media/opfs-media-store'
import { getObjectUrl, revokeObjectUrl } from '@/lib/media/object-urls'
import { clearWaveformPeaks } from '@/lib/media/waveform'
import type { ClipDragState, EditorUiState } from '@/types/editor'
import type { MediaSource, ProjectDocument, TimeMs } from '@/types/timeline'

function documentUsesOpfsKey(document: ProjectDocument, key: string): boolean {
  return document.mediaSources.some(
    (source) => source.locator.kind === 'opfs' && source.locator.key === key,
  )
}
import { clamp } from '@/utils/time'

interface EditorActions {
  setProjectName: (name: string) => void
  requestSave: () => void
  setSaveStatus: (
    status: EditorUiState['saveStatus'],
    details?: { lastSavedAt?: string | null; saveError?: string | null },
  ) => void
  loadDocument: (document: ProjectDocument, savedAt: string | null) => void
  selectClip: (
    clipId: string | null,
    options?: { additive?: boolean },
  ) => void
  selectMediaSource: (mediaSourceIds: string[]) => void
  setPlayheadMs: (ms: TimeMs) => void
  seekTo: (ms: TimeMs) => void
  play: () => void
  pause: () => void
  togglePlayback: () => void
  restartPlayback: () => void
  setIsPlaying: (playing: boolean) => void
  setPlaybackError: (error: string | null) => void
  setPixelsPerSecond: (pps: number) => void
  setTimelineScrollLeft: (left: number) => void
  setTimelineHeightPx: (height: number) => void
  setImportError: (error: string | null) => void
  setImportStatus: (status: EditorUiState['importStatus']) => void
  setClipDrag: (drag: ClipDragState | null) => void
  registerMediaSource: (source: MediaSource) => boolean
  unregisterMediaSource: (mediaSourceId: string) => boolean
  addClip: (mediaSourceId: string, timelineStartMs?: TimeMs, trackId?: string) => boolean
  removeClip: (clipId: string) => boolean
  moveClipTo: (
    clipId: string,
    timelineStartMs: TimeMs,
    trackId?: string,
  ) => boolean
  trimClipTo: (
    clipId: string,
    args: {
      sourceInMs?: TimeMs
      sourceOutMs?: TimeMs
      timelineStartMs?: TimeMs
    },
  ) => boolean
  linkSelectedClips: () => boolean
  unlinkSelectedClips: () => boolean
  splitClipsAt: (clipIds: string[], timelineCutMs: TimeMs) => boolean
  updateSelectedClipLabel: (label: string) => boolean
}

export type EditorStore = {
  document: ProjectDocument
  ui: EditorUiState
  clipDrag: ClipDragState | null
} & EditorActions

const initialUi: EditorUiState = {
  selectedClipIds: [],
  selectedMediaSourceIds: [],
  playheadMs: 0,
  isPlaying: false,
  seekVersion: 0,
  pixelsPerSecond: 80,
  timelineScrollLeft: 0,
  timelineHeightPx: 320,
  importError: null,
  importStatus: 'idle',
  playbackError: null,
  saveStatus: 'saved',
  saveError: null,
  saveRequest: 0,
  lastSavedAt: null,
}

function documentsEqual(a: ProjectDocument, b: ProjectDocument): boolean {
  return projectContentEqual(a, b)
}

/** Save clock lives outside applyOperation so replays stay deterministic. */
function commitDocument(
  current: ProjectDocument,
  next: ProjectDocument,
): ProjectDocument {
  if (projectContentEqual(current, next)) return current
  return touchDocument(next)
}

const editorStoreCreator: StateCreator<EditorStore> = (set, get) => ({
  document: unloadedProject,
  ui: initialUi,
  clipDrag: null,

  setProjectName: (name) => {
    const result = renameProject(get().document, name)
    if (!result.ok) return
    set({
      document: commitDocument(get().document, result.document),
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
  },

  requestSave: () => {
    set({
      ui: { ...get().ui, saveRequest: get().ui.saveRequest + 1 },
    })
  },

  setSaveStatus: (status, details) => {
    set({
      ui: {
        ...get().ui,
        saveStatus: status,
        lastSavedAt:
          details && 'lastSavedAt' in details
            ? (details.lastSavedAt ?? null)
            : get().ui.lastSavedAt,
        saveError:
          details && 'saveError' in details
            ? (details.saveError ?? null)
            : get().ui.saveError,
      },
    })
  },

  loadDocument: (document, savedAt) => {
    const temporal = useEditorStore.temporal.getState()
    temporal.pause()
    set({
      document,
      clipDrag: null,
      ui: {
        ...initialUi,
        saveStatus: 'saved',
        lastSavedAt: savedAt,
      },
    })
    temporal.clear()
    temporal.resume()
  },

  selectClip: (clipId, options) => {
    if (clipId == null) {
      set({
        ui: { ...get().ui, selectedClipIds: [] },
      })
      return
    }

    if (options?.additive) {
      const current = get().ui.selectedClipIds
      const next = current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId]
      set({
        ui: { ...get().ui, selectedClipIds: next },
      })
      return
    }

    set({
      ui: { ...get().ui, selectedClipIds: [clipId] },
    })
  },

  selectMediaSource: (mediaSourceIds) => {
    set({
      ui: {
        ...get().ui,
        selectedMediaSourceIds: mediaSourceIds,
      },
    })
  },

  setPlayheadMs: (ms) => {
    const endMs = getPlaybackEndMs(get().document)
    const rounded = Math.max(0, Math.round(ms))
    const next = endMs > 0 ? Math.min(rounded, endMs) : rounded
    set({
      ui: { ...get().ui, playheadMs: next },
    })
  },

  seekTo: (ms) => {
    const endMs = getPlaybackEndMs(get().document)
    const rounded = Math.max(0, Math.round(ms))
    const next = endMs > 0 ? Math.min(rounded, endMs) : rounded
    set({
      ui: {
        ...get().ui,
        playheadMs: next,
        seekVersion: get().ui.seekVersion + 1,
        playbackError: null,
      },
    })
  },

  play: () => {
    const document = get().document
    const endMs = getPlaybackEndMs(document)
    if (endMs <= 0) {
      set({
        ui: {
          ...get().ui,
          isPlaying: false,
          playbackError: 'Add a clip to the active track to play the timeline.',
        },
      })
      return
    }

    let playheadMs = get().ui.playheadMs
    let seekVersion = get().ui.seekVersion
    if (playheadMs >= endMs) {
      playheadMs = 0
      seekVersion += 1
    }

    set({
      ui: {
        ...get().ui,
        playheadMs,
        seekVersion,
        isPlaying: true,
        playbackError: null,
      },
    })
  },

  pause: () => {
    set({
      ui: { ...get().ui, isPlaying: false },
    })
  },

  togglePlayback: () => {
    if (get().ui.isPlaying) {
      get().pause()
    } else {
      get().play()
    }
  },

  restartPlayback: () => {
    set({
      ui: {
        ...get().ui,
        playheadMs: 0,
        seekVersion: get().ui.seekVersion + 1,
        isPlaying: true,
        playbackError: null,
      },
    })
  },

  setIsPlaying: (playing) => {
    set({
      ui: { ...get().ui, isPlaying: playing },
    })
  },

  setPlaybackError: (error) => {
    set({
      ui: {
        ...get().ui,
        playbackError: error,
        isPlaying: error ? false : get().ui.isPlaying,
      },
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

  setTimelineHeightPx: (height) => {
    set({
      ui: {
        ...get().ui,
        timelineHeightPx: clamp(Math.round(height), 220, 720),
      },
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
      document: commitDocument(get().document, result.document),
      ui: {
        ...get().ui,
        importError: null,
        saveStatus: 'unsaved',
      },
    })
    temporal.resume()
    return true
  },

  unregisterMediaSource: (mediaSourceId) => {
    const removed = get().document.mediaSources.find(
      (source) => source.id === mediaSourceId,
    )
    const temporal = useEditorStore.temporal.getState()
    temporal.pause()
    const result = removeMediaSource(get().document, mediaSourceId)
    if (!result.ok) {
      temporal.resume()
      return false
    }
    const objectUrl = getObjectUrl(mediaSourceId)
    if (objectUrl) clearFilmstripFramesForObjectUrl(objectUrl)
    revokeObjectUrl(mediaSourceId)
    clearWaveformPeaks(mediaSourceId)
    const ui = get().ui
    set({
      document: commitDocument(get().document, result.document),
      ui: {
        ...ui,
        selectedMediaSourceIds: ui.selectedMediaSourceIds.filter(
          (id) => id !== mediaSourceId,
        ),
        selectedClipIds: ui.selectedClipIds.filter((id) =>
          result.document.clips.some((clip) => clip.id === id),
        ),
        saveStatus: 'unsaved',
      },
    })
    temporal.resume()
    if (removed?.locator.kind === 'opfs') {
      const key = removed.locator.key
      const history = useEditorStore.temporal.getState()
      const snapshots = [
        get().document,
        ...history.pastStates.map((state) => state.document),
        ...history.futureStates.map((state) => state.document),
      ].filter((document): document is ProjectDocument => document != null)
      if (!snapshots.some((document) => documentUsesOpfsKey(document, key))) {
        void deleteMedia(key).catch(() => undefined)
      }
    }
    return true
  },

  addClip: (mediaSourceId, timelineStartMs, trackId) => {
    const result = addMediaToTimeline({
      document: get().document,
      mediaSourceId,
      timelineStartMs,
      trackId,
    })
    if (!result.ok) {
      get().setImportError(result.error)
      return false
    }
    set({
      document: commitDocument(get().document, result.document),
      ui: {
        ...get().ui,
        selectedClipIds: result.clipId ? [result.clipId] : [],
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
      document: commitDocument(get().document, result.document),
      ui: {
        ...ui,
        selectedClipIds: ui.selectedClipIds.filter((id) => id !== clipId),
        isPlaying: false,
        saveStatus: 'unsaved',
      },
    })
    return true
  },

  moveClipTo: (clipId, timelineStartMs, trackId) => {
    const result = moveClipOnTimeline({
      document: get().document,
      clipId,
      timelineStartMs,
      trackId,
    })
    if (!result.ok) return false
    set({
      document: commitDocument(get().document, result.document),
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
    return true
  },

  trimClipTo: (clipId, args) => {
    let document = get().document
    const clip = document.clips.find((item) => item.id === clipId)
    if (!clip) return false

    const linked = getLinkedClips(document, clipId)
    const targets = linked.length > 1 ? linked : [clip]

    const primaryResult = trimClip({
      document,
      clipId,
      ...args,
    })
    if (!primaryResult.ok) return false
    document = primaryResult.document

    const trimmedPrimary = document.clips.find((item) => item.id === clipId)
    if (!trimmedPrimary) return false

    if (targets.length > 1) {
      for (const member of targets) {
        if (member.id === clipId) continue
        const result = trimClip({
          document,
          clipId: member.id,
          sourceInMs: trimmedPrimary.sourceInMs,
          sourceOutMs: trimmedPrimary.sourceOutMs,
          timelineStartMs: trimmedPrimary.timelineStartMs,
        })
        if (!result.ok) return false
        document = result.document
      }
    }

    set({
      document: commitDocument(get().document, document),
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
    return true
  },

  linkSelectedClips: () => {
    const clipIds = get().ui.selectedClipIds
    if (clipIds.length === 0) return false
    const result = linkClips(get().document, clipIds)
    if (!result.ok) {
      get().setImportError(result.error)
      return false
    }
    set({
      document: commitDocument(get().document, result.document),
      ui: { ...get().ui, importError: null, saveStatus: 'unsaved' },
    })
    return true
  },

  unlinkSelectedClips: () => {
    const clipIds = get().ui.selectedClipIds
    if (clipIds.length === 0) return false
    const result = unlinkClips(get().document, clipIds)
    if (!result.ok) return false
    set({
      document: commitDocument(get().document, result.document),
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
    return true
  },

  splitClipsAt: (clipIds, timelineCutMs) => {
    if (clipIds.length === 0) return false
    const result = splitClipsAtTime(get().document, clipIds, timelineCutMs)
    if (!result.ok) return false
    set({
      document: commitDocument(get().document, result.document),
      ui: { ...get().ui, saveStatus: 'unsaved' },
    })
    return true
  },

  updateSelectedClipLabel: (label) => {
    const clipId = get().ui.selectedClipIds[0]
    if (!clipId) return false
    const result = updateClipLabel(get().document, clipId, label)
    if (!result.ok) return false
    set({
      document: commitDocument(get().document, result.document),
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
