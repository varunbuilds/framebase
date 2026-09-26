import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { EditorShell } from '@/components/layout/EditorShell'
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

export function EditorPage() {
  const project = editorRoute.useLoaderData()
  const loadDocument = useEditorStore((state) => state.loadDocument)
  const workspace = useWorkspace()
  const { id: projectId, document: storedDocument, updatedAt } = project
  const openKey = `${projectId}:${updatedAt}`
  const [openedKey, setOpenedKey] = useState<string | null>(null)
  const [structureKey, setStructureKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<EditorSessionPhase>('opening')
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const openedRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    if (workspace.status !== 'ready') return
    const alreadyOpen = openedRef.current === openKey
    void (async () => {
      await Promise.resolve()
      if (!active) return
      if (!alreadyOpen) {
        setPhase('opening')
        setStatusLabel('Opening project…')
        const mediaIds = new Set(storedDocument.mediaSources.map((source) => source.id))
        revokeObjectUrlsExcept(mediaIds)
        retainRuntimeDerivedCaches(mediaIds)
        loadDocument(storedDocument, updatedAt)
        setStructureKey(openKey)
        setPhase('syncing')
      }
      const report = await syncProjectMediaOnce({
        document: storedDocument,
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
        document: storedDocument,
        prepare: () => hydrateDocumentMediaOnce(storedDocument).then(() => undefined),
        commit: () => undefined,
      })
      if (!active || !committed) return
      if (alreadyOpen) return
      openedRef.current = openKey
      setPhase('ready')
      setStatusLabel(null)
      setOpenedKey(openKey)
      const storedKeys = storedDocument.mediaSources.flatMap((source) =>
        source.locator.kind === 'opfs' || source.locator.kind === 'local'
          ? [source.locator.key]
          : [],
      )
      void copyLegacyOpfsMediaIntoWorkspace(storedKeys)
      void mirrorCurrentProject(storedDocument).catch(() => undefined)
    })()
    return () => {
      active = false
    }
  }, [loadDocument, openKey, storedDocument, updatedAt, workspace.status])

  const displayedPhase: EditorSessionPhase =
    workspace.status === 'restoring'
      ? 'restoring-workspace'
      : workspace.status !== 'ready'
        ? 'needs-workspace'
        : phase
  const structureReady = structureKey === openKey && workspace.status === 'ready'
  const interactive = openedKey === openKey
  const label =
    displayedPhase === 'restoring-workspace' ? 'Restoring workspace…' : statusLabel

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
    <main className="grid h-dvh place-items-center bg-fb-app px-6 text-center">
      <div>
        <h1 className="text-[20px] font-semibold text-fb-text">
          This project is not available
        </h1>
        <p className="mt-2 max-w-[36ch] text-[13px] text-fb-muted">
          It may have been deleted, or it belongs to another account.
        </p>
        <Link
          to="/projects"
          className="mt-6 inline-block h-9 rounded-md bg-white px-3 text-[13px] font-medium leading-9 text-black no-underline"
        >
          Back to projects
        </Link>
      </div>
    </main>
  )
}

export function EditorLoadError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Could not open this project'
  return (
    <main className="grid h-dvh place-items-center bg-fb-app px-6 text-center">
      <div>
        <h1 className="text-[20px] font-semibold text-fb-text">
          Could not open this project
        </h1>
        <p className="mt-2 max-w-[42ch] text-[13px] text-fb-danger">{message}</p>
        <Link
          to="/projects"
          className="mt-6 inline-block h-9 rounded-md bg-white px-3 text-[13px] font-medium leading-9 text-black no-underline"
        >
          Back to projects
        </Link>
      </div>
    </main>
  )
}
