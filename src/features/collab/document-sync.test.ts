import { LiveObject } from '@liveblocks/client'
import { describe, expect, it } from 'vitest'
import { applyOperation } from '@/features/editor/apply-operation'
import { createEmptyProject, unloadedProject } from '@/features/editor/project'
import type { EditorStore } from '@/stores/editor-store'
import type { Clip, MediaSource, ProjectDocument, Track } from '@/types/timeline'
import {
  createCollabStorage,
  readCollabDocument,
  type CollabRoot,
} from './collab-document'
import {
  adoptRemoteDocument,
  bindCollabDocument,
  type EditorStoreHandle,
} from './document-sync'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function mediaSource(overrides: Partial<MediaSource> = {}): MediaSource {
  return {
    id: 'media_1',
    name: 'take-1.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: true,
    durationMs: 12_000,
    mimeType: 'video/mp4',
    locator: { kind: 'local', key: 'media_1' },
    availability: 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    mediaSourceId: 'media_1',
    trackId: 'track_video',
    timelineStartMs: 0,
    sourceInMs: 0,
    sourceOutMs: 4_000,
    ...overrides,
  }
}

function tracks(): Track[] {
  return [
    { id: 'track_video', name: 'Video 1', kind: 'video', order: 0, muted: false, locked: false },
    { id: 'track_audio', name: 'Audio 1', kind: 'audio', order: 1, muted: false, locked: false },
  ]
}

function document(): ProjectDocument {
  const base = createEmptyProject('Launch cut', PROJECT_ID, '9:16')
  return {
    ...base,
    tracks: tracks(),
    mediaSources: [mediaSource()],
    clips: [clip(), clip({ id: 'clip_2', timelineStartMs: 6_000 })],
  }
}

function rootFrom(source: ProjectDocument): CollabRoot {
  return new LiveObject(createCollabStorage(source)) as CollabRoot
}

function createHandle(initial: ProjectDocument): EditorStoreHandle & {
  historyPaused: number
  pastDocuments: ProjectDocument[]
} {
  const pastDocuments: ProjectDocument[] = []
  let historyPaused = 0
  let paused = false
  const listeners = new Set<(state: EditorStore, previous: EditorStore) => void>()

  const ui = {
    selectedClipIds: [] as string[],
    selectedMediaSourceIds: [] as string[],
    playheadMs: 0,
    isPlaying: false,
    seekVersion: 0,
    pixelsPerSecond: 80,
    timelineScrollLeft: 0,
    timelineHeightPx: 320,
    importError: null,
    importStatus: 'idle' as const,
    playbackError: null,
    saveStatus: 'saved' as const,
    saveError: null,
    saveRequest: 0,
    lastSavedAt: null,
  }

  let state = {
    document: initial,
    ui,
    clipDrag: null,
    loadDocument(next: ProjectDocument, savedAt: string | null) {
      handle.setState({
        document: next,
        clipDrag: null,
        ui: { ...ui, saveStatus: 'saved', lastSavedAt: savedAt },
      })
    },
  } as EditorStore

  const handle: EditorStoreHandle & {
    historyPaused: number
    pastDocuments: ProjectDocument[]
  } = {
    get historyPaused() {
      return historyPaused
    },
    pastDocuments,
    getState: () => state,
    setState(partial) {
      const previous = state
      const next = { ...state, ...partial }
      if (!paused && previous.document !== next.document) {
        pastDocuments.push(previous.document)
      }
      state = next
      for (const listener of listeners) listener(state, previous)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    temporal: {
      getState: () => ({
        pause() {
          paused = true
          historyPaused += 1
        },
        resume() {
          paused = false
        },
      }),
    },
  }

  return handle
}

describe('adoptRemoteDocument', () => {
  it('drops selection and drag that point at a deleted clip', () => {
    const next = document()
    const previous = {
      document: next,
      ui: {
        selectedClipIds: ['clip_1', 'clip_gone'],
        selectedMediaSourceIds: ['media_1', 'media_gone'],
        playheadMs: 1_200,
        isPlaying: false,
        seekVersion: 0,
        pixelsPerSecond: 80,
        timelineScrollLeft: 0,
        timelineHeightPx: 320,
        importError: null,
        importStatus: 'idle' as const,
        playbackError: null,
        saveStatus: 'saved' as const,
        saveError: null,
        saveRequest: 0,
        lastSavedAt: null,
      },
      clipDrag: {
        clipId: 'clip_gone',
        mode: 'move',
        originClientX: 0,
        originClientY: 0,
        originTrackId: 'track_video',
        originTimelineStartMs: 0,
        originSourceInMs: 0,
        originSourceOutMs: 4_000,
      },
    } as EditorStore

    const adopted = adoptRemoteDocument(previous, next)
    expect(adopted.ui?.selectedClipIds).toEqual(['clip_1'])
    expect(adopted.ui?.selectedMediaSourceIds).toEqual(['media_1'])
    expect(adopted.clipDrag).toBeNull()
    expect(adopted.ui?.playheadMs).toBe(1_200)
  })
})

describe('bindCollabDocument', () => {
  it('hydrates the editor from storage and applies clip.move through the existing operation', () => {
    const original = document()
    const storageRoot = rootFrom(original)
    const store = createHandle(unloadedProject)
    const listeners: Array<() => void> = []

    const binding = bindCollabDocument({
      projectId: PROJECT_ID,
      root: storageRoot,
      fallbackDocument: original,
      store,
      batch: (run) => run(),
      subscribeToStorage: (listener) => {
        listeners.push(listener)
        return () => undefined
      },
    })

    expect(store.getState().document.id).toBe(PROJECT_ID)
    expect(store.getState().document.clips.map((item) => item.id)).toEqual([
      'clip_1',
      'clip_2',
    ])

    const moved = applyOperation(store.getState().document, {
      type: 'clip.move',
      clipId: 'clip_1',
      trackId: 'track_video',
      timelineStartMs: 2_500,
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    store.setState({ document: moved.document })

    expect(storageRoot.get('clips').get('clip_1')?.get('timelineStartMs')).toBe(2_500)
    expect(readCollabDocument(storageRoot).clips.find((item) => item.id === 'clip_2')
      ?.timelineStartMs).toBe(6_000)
    binding.dispose()
    expect(listeners).toHaveLength(1)
  })

  it('applies a remote clip.move without recording it in local undo history', () => {
    const original = document()
    const storageRoot = rootFrom(original)
    const store = createHandle(original)
    const storageListeners: Array<() => void> = []

    bindCollabDocument({
      projectId: PROJECT_ID,
      root: storageRoot,
      fallbackDocument: original,
      store,
      batch: (run) => run(),
      subscribeToStorage: (listener) => {
        storageListeners.push(listener)
        return () => undefined
      },
    })

    storageRoot.get('clips').get('clip_2')?.set('timelineStartMs', 9_000)
    for (const listener of storageListeners) listener()

    expect(store.getState().document.clips.find((item) => item.id === 'clip_2')
      ?.timelineStartMs).toBe(9_000)
    expect(store.historyPaused).toBeGreaterThan(0)
    expect(store.pastDocuments).toEqual([])
  })

  it('does not write another project’s document into this room', () => {
    const original = document()
    const storageRoot = rootFrom(original)
    const store = createHandle(original)

    bindCollabDocument({
      projectId: PROJECT_ID,
      root: storageRoot,
      fallbackDocument: original,
      store,
      batch: (run) => run(),
      subscribeToStorage: () => () => undefined,
    })

    store.setState({
      document: { ...original, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Other' },
    })

    expect(storageRoot.get('project').get('name')).toBe('Launch cut')
    expect(storageRoot.get('project').get('id')).toBe(PROJECT_ID)
  })
})
