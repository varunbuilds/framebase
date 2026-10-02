import { getRouteApi, Link } from '@tanstack/react-router'
import { AppChrome } from '@/components/layout/AppChrome'
import { useEffect, useRef, useState } from 'react'
import { EditorShell } from '@/components/layout/EditorShell'
import { ProjectRoom } from '@/features/collab/ProjectRoom'
import { useCollabSession } from '@/features/collab/collab-session-context'
import { collabIndicator } from '@/features/collab/collab-session'
import { EditorSessionProvider } from '@/features/editor/editor-session-context'
import {
  autosaveEnabled,
  type EditorSessionPhase,
} from '@/features/editor/editor-session'
import { hydrateDocumentMediaOnce } from '@/lib/media/hydrate-project-media'
import { revokeObjectUrlsExcept } from '@/lib/media/object-urls'
import { hasMedia } from '@/lib/media/opfs-media-store'
import { downloadSharedSource } from '@/lib/media/publish-source'
import { retainRuntimeDerivedCaches } from '@/lib/media/runtime-caches'
import { setCloudTransfer } from '@/lib/media/cloud-transfer'
import {
  commitPreparedProject,
  syncProgressLabel,
  syncProjectMediaOnce,
} from '@/lib/media/sync-project-media'
import { copyLegacyOpfsMediaIntoWorkspace } from '@/lib/workspace/workspace-migration'
import { mirrorCurrentProject } from '@/lib/workspace/workspace-manager'
import { useWorkspace } from '@/lib/workspace/use-workspace'
import { useProjectAutosave } from '@/features/projects/use-project-autosave'
import { useEditorStore } from '@/stores/editor-store'
const editorRoute = getRouteApi('/authenticated/editor/$projectId')

/**
 * Auth and project authorization already happened in the route. The editor then
 * joins `framebase:<projectId>`, and the collaborative document replaces the
 * stored Supabase snapshot as the document the editor edits. The snapshot is
 * still what seeds a brand new room.
 */
export function EditorPage() {
  const project = editorRoute.useLoaderData()
  return (
    <ProjectRoom
      projectId={project.id}
      initialDocument={project.document}
      savedAt={project.updatedAt}
    >
      <EditorProjectSession />
    </ProjectRoom>
  )
}

function EditorProjectSession() {
  const project = editorRoute.useLoaderData()
  const workspace = useWorkspace()
  const collab = useCollabSession()
  const { id: projectId } = project
  const collabReady = collab?.phase === 'ready'
  const openKey = projectId
  const [openedKey, setOpenedKey] = useState<string | null>(null)
  const [structureKey, setStructureKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<EditorSessionPhase>('opening')
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const openedRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    if (workspace.status !== 'ready') return
    // The room owns the document, so the open sequence waits for its storage.
    if (!collabReady) return
    const collabDocument = useEditorStore.getState().document
    if (collabDocument.id !== projectId) return
    const alreadyOpen = openedRef.current === openKey
    void (async () => {
      await Promise.resolve()
      if (!active) return
      if (!alreadyOpen) {
        setPhase('opening')
        setStatusLabel('Opening project…')
        const mediaIds = new Set(collabDocument.mediaSources.map((source) => source.id))
        revokeObjectUrlsExcept(mediaIds)
        retainRuntimeDerivedCaches(mediaIds)
        setStructureKey(openKey)
        setPhase('syncing')
      }
      const report = await syncProjectMediaOnce({
        document: collabDocument,
        workspaceReady: true,
        hasLocal: (mediaSourceId) => hasMedia(mediaSourceId),
        download: async (source) => {
          try {
            await downloadSharedSource(source)
          } catch (error) {
            setCloudTransfer(source.id, {
              phase: 'error',
              progress: null,
              message: error instanceof Error ? error.message : 'Download failed.',
            })
            throw error
          }
        },
        onProgress: (done, total) => {
          if (active && !alreadyOpen && total > 0) {
            setStatusLabel(syncProgressLabel(done, total))
          }
        },
      })
      if (!active) return
      for (const item of report.items) {
        if (item.outcome !== 'failed') continue
        setCloudTransfer(item.mediaSourceId, {
          phase: 'error',
          progress: null,
          message: 'Download failed.',
        })
      }
      if (!alreadyOpen) setPhase('hydrating')
      const committed = await commitPreparedProject({
        isActive: () => active,
        document: collabDocument,
        prepare: () => hydrateDocumentMediaOnce(collabDocument).then(() => undefined),
        commit: () => undefined,
      })
      if (!active || !committed) return
      if (alreadyOpen) return
      openedRef.current = openKey
      setPhase('ready')
      setStatusLabel(null)
      setOpenedKey(openKey)
      const storedKeys = collabDocument.mediaSources.flatMap((source) =>
        source.locator.kind === 'opfs' || source.locator.kind === 'local'
          ? [source.locator.key]
          : [],
      )
      void copyLegacyOpfsMediaIntoWorkspace(storedKeys)
      void mirrorCurrentProject(collabDocument).catch(() => undefined)
    })()
    return () => {
      active = false
    }
  }, [collabReady, openKey, projectId, workspace.status])

  const collabStatus = collab ? collabIndicator(collab) : null
  const displayedPhase: EditorSessionPhase =
    workspace.status === 'restoring'
      ? 'restoring-workspace'
      : workspace.status !== 'ready'
        ? 'needs-workspace'
        : phase
  const structureReady =
    structureKey === openKey && workspace.status === 'ready' && collabReady
  const interactive = openedKey === openKey && collabReady
  const label =
    displayedPhase === 'restoring-workspace'
      ? 'Restoring workspace…'
      : !collabReady
        ? (collabStatus?.short ?? 'Connecting…')
        : statusLabel

  return (
    <EditorSessionProvider
      value={{
        phase: displayedPhase,
        statusLabel: interactive ? null : label,
        structureReady,
        interactive,
      }}
    >
      <EditorShell />
      {autosaveEnabled(interactive ? 'ready' : displayedPhase) ? (
        <ProjectAutosave projectId={projectId} />
      ) : null}
    </EditorSessionProvider>
  )
}

function ProjectAutosave({ projectId }: { projectId: string }) {
  useProjectAutosave(projectId)
  return null
}

export function EditorNotFound() {
  return (
    <AppChrome>
      <main className="relative z-[1] grid h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-[32px] font-bold tracking-[-0.04em] text-[#f4f4f4]">
            This project is not available
          </h1>
          <p className="mt-3 max-w-[36ch] text-[15px] text-[rgba(243,244,244,0.72)]">
            It may have been deleted, or it belongs to another account.
          </p>
          <Link to="/projects" className="app-btn mt-8">
            Back to projects
          </Link>
        </div>
      </main>
    </AppChrome>
  )
}

export function EditorLoadError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Could not open this project'
  return (
    <AppChrome>
      <main className="relative z-[1] grid h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-[32px] font-bold tracking-[-0.04em] text-[#f4f4f4]">
            Could not open this project
          </h1>
          <p className="mt-3 max-w-[42ch] text-[15px] text-fb-danger">{message}</p>
          <Link to="/projects" className="app-btn mt-8">
            Back to projects
          </Link>
        </div>
      </main>
    </AppChrome>
  )
}
