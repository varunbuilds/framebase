import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { EditorShell } from '@/components/layout/EditorShell'
import {
  commitHydratedDocument,
  hydrateDocumentMediaOnce,
} from '@/lib/media/hydrate-project-media'
import { revokeObjectUrlsExcept } from '@/lib/media/object-urls'
import { retainRuntimeDerivedCaches } from '@/lib/media/runtime-caches'
import { copyLegacyOpfsMediaIntoWorkspace } from '@/lib/workspace/workspace-migration'
import { mirrorCurrentProject } from '@/lib/workspace/workspace-manager'
import { useProjectAutosave } from '@/features/projects/use-project-autosave'
import { useEditorStore } from '@/stores/editor-store'
const editorRoute = getRouteApi('/authenticated/editor/$projectId')

function OpeningProject() {
  return (
    <main className="grid h-dvh place-items-center bg-fb-app text-[13px] text-fb-muted">
      Opening project…
    </main>
  )
}

export function EditorPage() {
  const project = editorRoute.useLoaderData()
  const loadDocument = useEditorStore((state) => state.loadDocument)
  const { id: projectId, document: storedDocument, updatedAt } = project
  const openKey = `${projectId}:${updatedAt}`
  const [openedKey, setOpenedKey] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void hydrateDocumentMediaOnce(storedDocument).then((hydrated) => {
      const committed = commitHydratedDocument({
        active,
        hydrated: hydrated.document,
        load: (document) => {
          const mediaIds = new Set(document.mediaSources.map((source) => source.id))
          revokeObjectUrlsExcept(mediaIds)
          retainRuntimeDerivedCaches(mediaIds)
          loadDocument(document, updatedAt)
        },
      })
      if (committed) {
        setOpenedKey(openKey)
        const storedKeys = hydrated.document.mediaSources.flatMap((source) =>
          source.locator.kind === 'opfs' || source.locator.kind === 'local'
            ? [source.locator.key]
            : [],
        )
        void copyLegacyOpfsMediaIntoWorkspace(storedKeys)
        void mirrorCurrentProject(hydrated.document).catch(() => undefined)
      }
    })
    return () => {
      active = false
    }
  }, [loadDocument, openKey, storedDocument, updatedAt])

  if (openedKey !== openKey) return <OpeningProject />

  return (
    <>
      <EditorShell />
      <ProjectAutosave projectId={project.id} />
    </>
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
