import { create, type StateCreator } from 'zustand'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import {
  addClipFromMedia,
  addMediaSource,
  createTrack,
  deleteClip,
  moveClip,
  removeMediaSource,
  renameProject,
  trimClip,
  updateClipLabel,
} from '@/features/editor/operations'
import { getPlaybackEndMs } from '@/features/editor/playback'
import { createEmptyProject } from '@/features/editor/project'
import { revokeObjectUrl } from '@/lib/media/object-urls'
import type { ClipDragState, EditorUiState } from '@/types/editor'
import type { Clip, MediaSource, ProjectDocument, TimeMs, Track } from '@/types/timeline'
import { clamp } from '@/utils/time'

interface EditorActions {
  setProjectName: (name: string) => void
  markSaved: () => void
  selectClip: (clipId: string | null) => void
  selectMediaSource: (mediaSourceId: string | null) => void
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
  seekVersion: 0,
  pixelsPerSecond: 80,
  timelineScrollLeft: 0,
  importError: null,
  importStatus: 'idle',
  playbackError: null,
  saveStatus: 'unsaved',
  lastSavedAt: null,
}

function documentsEqual(a: ProjectDocument, b: ProjectDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function overlaps(
  startMs: number,
  durationMs: number,
  candidate: Clip,
): boolean {
  const endMs = startMs + durationMs
  const candidateEndMs = candidate.timelineStartMs +
    (candidate.sourceOutMs - candidate.sourceInMs)
  return startMs < candidateEndMs && endMs > candidate.timelineStartMs
}

function snapStartMs(
  document: ProjectDocument,
  clip: Clip,
  trackId: string,
  startMs: number,
): number {
  const durationMs = clip.sourceOutMs - clip.sourceInMs
  const snapDistanceMs = 180
  let nearest = startMs
  let nearestDistance = snapDistanceMs + 1
  for (const candidate of document.clips) {
    if (candidate.id === clip.id || candidate.trackId !== trackId) continue
    const candidateEndMs = candidate.timelineStartMs +
      (candidate.sourceOutMs - candidate.sourceInMs)
    for (const point of [candidateEndMs, candidate.timelineStartMs - durationMs]) {
      const distance = Math.abs(startMs - point)
      if (distance < nearestDistance) {
        nearest = Math.max(0, point)
        nearestDistance = distance
      }
    }
  }
  return nearest
}

function findOpenTrack(
  document: ProjectDocument,
  clip: Clip,
  kind: Track['kind'],
  startMs: number,
): Track | undefined {
  const durationMs = clip.sourceOutMs - clip.sourceInMs
  return document.tracks
    .filter((track) => track.kind === kind && !track.locked)
    .sort((a, b) => a.order - b.order)
    .find((track) =>
      document.clips
        .filter((candidate) => candidate.trackId === track.id && candidate.id !== clip.id)
        .every((candidate) => !overlaps(startMs, durationMs, candidate)),
    )
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
    const startMs = timelineStartMs ?? get().ui.playheadMs
    const result = addClipFromMedia({
      document: get().document,
      mediaSourceId,
      timelineStartMs: startMs,
    })
    if (!result.ok) {
      get().setImportError(result.error)
      return false
    }
    const source = get().document.mediaSources.find((item) => item.id === mediaSourceId)
    const linkedAudioResult = source?.kind === 'video' && source.linkedMediaSourceId
      ? addClipFromMedia({
          document: result.document,
          mediaSourceId: source.linkedMediaSourceId,
          timelineStartMs: startMs,
        })
      : undefined
    const document = linkedAudioResult?.ok
      ? linkedAudioResult.document
      : result.document
    set({
      document,
      ui: {
        ...get().ui,
        selectedClipId: result.clipId ?? null,
        importError: null,
        saveStatus: 'unsaved',
      },
    })
    // Route each new instance through the placement rules so timeline clips
    // never remain overlapped after an insert at the playhead.
    if (result.clipId) get().moveClipTo(result.clipId, startMs)
    if (linkedAudioResult?.ok && linkedAudioResult.clipId) {
      get().moveClipTo(linkedAudioResult.clipId, startMs)
    }
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
    let document = get().document
    const clip = document.clips.find((item) => item.id === clipId)
    if (!clip) return false
    const source = document.mediaSources.find(
      (item) => item.id === clip.mediaSourceId,
    )
    if (!source) return false

    let destinationTrackId = trackId ?? clip.trackId
    let snappedStartMs = snapStartMs(
      document,
      clip,
      destinationTrackId,
      timelineStartMs,
    )
    const destinationTrack = document.tracks.find(
      (track) => track.id === destinationTrackId,
    )
    if (!destinationTrack) return false

    const destinationHasOverlap = document.clips
      .filter((candidate) => candidate.trackId === destinationTrackId && candidate.id !== clip.id)
      .some((candidate) =>
        overlaps(
          snappedStartMs,
          clip.sourceOutMs - clip.sourceInMs,
          candidate,
        ),
      )

    if (destinationHasOverlap) {
      const openTrack = findOpenTrack(document, clip, source.kind, snappedStartMs)
      if (openTrack) {
        destinationTrackId = openTrack.id
      } else {
        const kindTracks = document.tracks.filter((track) => track.kind === source.kind)
        const order = source.kind === 'video'
          ? Math.min(...kindTracks.map((track) => track.order)) - 1
          : Math.max(...kindTracks.map((track) => track.order)) + 1
        const created = createTrack({
          document,
          kind: source.kind,
          order,
          name: `${source.kind === 'video' ? 'Video' : 'Audio'} ${kindTracks.length + 1}`,
        })
        if (!created.ok) return false
        document = created.document
        destinationTrackId = document.tracks[document.tracks.length - 1].id
      }
      snappedStartMs = timelineStartMs
    }

    const result = moveClip({
      document,
      clipId,
      timelineStartMs: snappedStartMs,
      trackId: destinationTrackId,
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
    const trimmedClip = result.document.clips.find((clip) => clip.id === clipId)
    if (trimmedClip) get().moveClipTo(clipId, trimmedClip.timelineStartMs)
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
