/**
 * Liveblocks types for Framebase.
 *
 * Storage is the authoritative collaborative editor document for one project
 * room (`framebase:<projectId>`). It holds structured editor state keyed by the
 * same stable ids the domain model uses, so concurrent edits to different
 * tracks, clips or media sources merge instead of overwriting each other.
 *
 * Media binaries are never stored here. They stay in Supabase Storage, the
 * local workspace and OPFS.
 *
 * Presence is ephemeral (cursor, selection, active area). It is not Storage
 * and it is not part of ProjectDocument.
 */
import type { LiveMap, LiveObject } from '@liveblocks/client'
import type {
  CollabClipFields,
  CollabMediaSourceFields,
  CollabProjectFields,
  CollabTrackFields,
} from '@/features/collab/collab-schema'
import type { EditorPresence } from '@/features/collab/presence-schema'

declare global {
  interface Liveblocks {
    Storage: {
      project: LiveObject<CollabProjectFields>
      tracks: LiveMap<string, LiveObject<CollabTrackFields>>
      clips: LiveMap<string, LiveObject<CollabClipFields>>
      mediaSources: LiveMap<string, LiveObject<CollabMediaSourceFields>>
    }

    /**
     * Set by the Liveblocks auth endpoint from the Supabase user.
     * `color` and `avatar` are filled by the client resolver for Liveblocks UI.
     */
    UserMeta: {
      id: string
      info: {
        name: string
        color?: string
        avatar?: string
      }
    }

    Presence: EditorPresence
  }
}

export {}
