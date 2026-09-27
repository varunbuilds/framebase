import {
  LiveblocksProvider,
  RoomProvider,
  useErrorListener,
  useRoom,
  useStatus,
  useStorageRoot,
  useSyncStatus,
} from '@liveblocks/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useEditorStore } from '@/stores/editor-store'
import type { ProjectDocument } from '@/types/timeline'
import {
  isProjectUuid,
  projectRoomId,
} from '../../../supabase/functions/_shared/project-room.ts'
import { createCollabStorage } from './collab-document'
import { resolveFramebaseUsers } from './collaborator-directory'
import { EMPTY_EDITOR_PRESENCE } from './presence-schema'
import { EditorPresenceBridge } from './use-collaborative-presence'
import {
  collabConnection,
  collabFailureForCode,
  collabPendingChanges,
  collabPhase,
  type CollabFailure,
  type CollabSessionView,
} from './collab-session'
import { CollabSessionProvider } from './collab-session-context'
import { bindCollabDocument } from './document-sync'
import { requestProjectRoomToken } from './liveblocks-auth'

/**
 * Joins `framebase:<projectId>` for one project and hydrates the editor from
 * that room's storage.
 *
 * Only this component enters a room, so the landing, login, signup and project
 * list pages are untouched. Storage is seeded from the project's existing
 * ProjectDocument the first time a room is created; after that the room is the
 * authoritative collaborative document. Presence starts empty and stays
 * ephemeral: cursors and selection never enter Storage.
 */
export function ProjectRoom({
  projectId,
  initialDocument,
  savedAt,
  children,
}: {
  projectId: string
  initialDocument: ProjectDocument
  savedAt: string | null
  children: ReactNode
}) {
  const roomId = useMemo(
    () => (isProjectUuid(projectId) ? projectRoomId(projectId) : null),
    [projectId],
  )

  if (!roomId) {
    return (
      <CollabSessionProvider
        value={{
          phase: 'failed',
          connection: 'disconnected',
          pendingChanges: false,
          errorMessage: 'This project id cannot be collaborated on.',
          inRoom: false,
        }}
      >
        {children}
      </CollabSessionProvider>
    )
  }

  return (
    <LiveblocksProvider
      authEndpoint={requestProjectRoomToken}
      resolveUsers={resolveFramebaseUsers}
    >
      <RoomProvider
        id={roomId}
        initialPresence={EMPTY_EDITOR_PRESENCE}
        initialStorage={() => createCollabStorage(initialDocument)}
      >
        <ProjectRoomSession
          projectId={projectId}
          fallbackDocument={initialDocument}
          savedAt={savedAt}
        >
          {children}
        </ProjectRoomSession>
      </RoomProvider>
    </LiveblocksProvider>
  )
}

function ProjectRoomSession({
  projectId,
  fallbackDocument,
  savedAt,
  children,
}: {
  projectId: string
  fallbackDocument: ProjectDocument
  savedAt: string | null
  children: ReactNode
}) {
  const room = useRoom()
  const [root] = useStorageRoot()
  const status = useStatus()
  const syncStatus = useSyncStatus({ smooth: true })
  const storeDocumentId = useEditorStore((state) => state.document.id)
  const [failure, setFailure] = useState<CollabFailure | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useErrorListener((error) => {
    if (error.context.type !== 'ROOM_CONNECTION_ERROR') return
    setFailure(collabFailureForCode(error.context.code))
    setErrorMessage(error.message)
  })

  if (status === 'connected' && failure != null) {
    setFailure(null)
    setErrorMessage(null)
  }

  useEffect(() => {
    if (!root) return
    const binding = bindCollabDocument({
      projectId,
      root,
      fallbackDocument,
      savedAt,
      batch: (run) => room.batch(run),
      subscribeToStorage: (listener) =>
        room.subscribe(root, listener, { isDeep: true }),
      onWriteError: (message) => setErrorMessage(message),
    })
    return () => binding.dispose()
  }, [fallbackDocument, projectId, room, root, savedAt])

  const documentReady = root != null && storeDocumentId === projectId

  const connection = collabConnection(status)
  const view: CollabSessionView = {
    phase: collabPhase({ connection, documentReady, failure }),
    connection,
    pendingChanges: collabPendingChanges(syncStatus),
    errorMessage,
    inRoom: true,
  }

  return (
    <CollabSessionProvider value={view}>
      <EditorPresenceBridge />
      {children}
    </CollabSessionProvider>
  )
}
