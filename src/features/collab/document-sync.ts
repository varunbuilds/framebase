import { useEditorStore, type EditorStore } from '@/stores/editor-store'
import type { ProjectDocument } from '@/types/timeline'
import {
  collabDocumentEqual,
  mediaAvailabilityOf,
  readCollabDocument,
  writeCollabDocument,
  type CollabRoot,
} from './collab-document'

/**
 * The single seam between the editor domain and Liveblocks.
 *
 * Nothing above this file knows that collaborative state is persisted by
 * Liveblocks. Components keep calling the Zustand actions, which keep calling
 * the deterministic `applyOperation` layer; this binding takes the resulting
 * ProjectDocument and applies the structural difference to Liveblocks Storage,
 * and applies changes that arrive from other clients back into the store.
 *
 *   interaction → deterministic operation → store document
 *                                              ↓
 *                                   structural diff into Storage
 *                                              ↓
 *                                   other clients read the change
 *
 * Remote changes are applied with the zundo history paused, so a collaborator's
 * edit never becomes something the local user can undo as if it were their own.
 */

/** The slice of the Zustand store this binding needs, so tests can supply one. */
export type EditorStoreHandle = {
  getState: () => EditorStore
  setState: (partial: Partial<EditorStore>) => void
  subscribe: (listener: (state: EditorStore, previous: EditorStore) => void) => () => void
  temporal: {
    getState: () => { pause: () => void; resume: () => void }
  }
}

export type CollabDocumentBinding = {
  /** The collaborative document that was loaded into the editor. */
  document: ProjectDocument
  dispose: () => void
}

export type BindCollabDocumentArgs = {
  projectId: string
  root: CollabRoot
  /** Registers a deep listener on storage. Returns its unsubscribe callback. */
  subscribeToStorage: (listener: () => void) => () => void
  /** Groups one document change into a single collaborative update. */
  batch: <T>(run: () => T) => T
  /** Seeds id/createdAt/name when the room has no project object yet. */
  fallbackDocument: ProjectDocument
  /** Last time this project was mirrored to Supabase, for the save indicator. */
  savedAt?: string | null
  store?: EditorStoreHandle
  onWriteError?: (message: string) => void
}

export function bindCollabDocument(
  args: BindCollabDocumentArgs,
): CollabDocumentBinding {
  const store = args.store ?? (useEditorStore as unknown as EditorStoreHandle)
  let applyingRemote = false
  let writingLocal = false
  let disposed = false

  const readStorage = (): ProjectDocument =>
    readCollabDocument(args.root, {
      fallback: args.fallbackDocument,
      availability: mediaAvailabilityOf(store.getState().document),
    })

  /** What this client believes storage holds. Deletions are diffed against it. */
  let synced = readStorage()

  // Strict Mode remounts this binding. Reloading an identical document would
  // reset the playhead, the selection, and the undo history for no reason.
  const current = store.getState().document
  if (current.id !== synced.id || !collabDocumentEqual(current, synced)) {
    store.getState().loadDocument(synced, args.savedAt ?? null)
  }

  const applyRemote = () => {
    if (disposed || writingLocal) return
    const next = readStorage()
    synced = next
    const state = store.getState()
    if (state.document.id !== next.id) return
    if (collabDocumentEqual(state.document, next)) return

    applyingRemote = true
    const temporal = store.temporal.getState()
    temporal.pause()
    try {
      store.setState(adoptRemoteDocument(state, next))
    } finally {
      temporal.resume()
      applyingRemote = false
    }
  }

  const pushLocal = (document: ProjectDocument) => {
    if (disposed || applyingRemote) return
    // The placeholder document and other projects never reach this room.
    if (document.id !== args.projectId) return
    if (collabDocumentEqual(synced, document)) {
      synced = document
      return
    }
    writingLocal = true
    try {
      args.batch(() => writeCollabDocument(args.root, synced, document))
      synced = document
    } catch (error) {
      args.onWriteError?.(
        error instanceof Error ? error.message : 'Could not sync this change.',
      )
    } finally {
      writingLocal = false
    }
  }

  const unsubscribeStorage = args.subscribeToStorage(applyRemote)
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.document === previous.document) return
    pushLocal(state.document)
  })

  return {
    document: synced,
    dispose() {
      disposed = true
      unsubscribeStorage()
      unsubscribeStore()
    },
  }
}

/**
 * Takes a remote document while keeping local UI state coherent. A clip deleted
 * by someone else must leave the selection and cancel an in-flight drag rather
 * than leave the editor pointing at something that is gone.
 */
export function adoptRemoteDocument(
  state: EditorStore,
  document: ProjectDocument,
): Partial<EditorStore> {
  const clipIds = new Set(document.clips.map((clip) => clip.id))
  const mediaIds = new Set(document.mediaSources.map((source) => source.id))
  const selectedClipIds = state.ui.selectedClipIds.filter((id) => clipIds.has(id))
  const selectedMediaSourceIds = state.ui.selectedMediaSourceIds.filter((id) =>
    mediaIds.has(id),
  )
  const dragStillValid =
    state.clipDrag != null && clipIds.has(state.clipDrag.clipId)

  return {
    document,
    clipDrag: dragStillValid ? state.clipDrag : null,
    ui: {
      ...state.ui,
      selectedClipIds,
      selectedMediaSourceIds,
      // The Supabase snapshot of this project is now behind the room.
      saveStatus: 'unsaved',
    },
  }
}
