import { getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { useAuth } from '@/features/auth/use-auth'
import { releaseProjectMedia } from '@/lib/media/release-project-media'
import {
  createProject,
  deleteProject,
  fetchProject,
  ProjectNotFoundError,
} from '@/features/projects/repository'
import type { CanvasAspectRatio, ProjectDocument } from '@/types/timeline'
const projectsRoute = getRouteApi('/authenticated/projects')

function formatUpdated(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ProjectsPage() {
  const loaded = projectsRoute.useLoaderData()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const router = useRouter()
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const projects = loaded.filter((project) => !removedIds.includes(project.id))
  const [creating, setCreating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const onCreate = async (project: {
    name: string
    aspectRatio: CanvasAspectRatio
  }) => {
    if (!user || creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await createProject(user.id, project)
      await navigate({
        to: '/editor/$projectId',
        params: { projectId: created.id },
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create project.')
      setCreating(false)
    }
  }

  const onDelete = async (projectId: string) => {
    setDeletingId(projectId)
    setError(null)
    try {
      let document: ProjectDocument | null = null
      try {
        document = (await fetchProject(projectId)).document
      } catch (caught) {
        if (caught instanceof ProjectNotFoundError) throw caught
      }
      await deleteProject(projectId)
      if (document) await releaseProjectMedia(document)
      setRemovedIds((current) => [...current, projectId])
      setConfirmingId(null)
      await router.invalidate()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete project.')
    } finally {
      setDeletingId(null)
    }
  }

  const onLogout = async () => {
    await signOut()
    await navigate({ to: '/' })
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-fb-app">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-fb-border px-6">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[11px] font-bold text-black">
            F
          </span>
          <span className="text-[13px] font-semibold text-fb-text">Framebase</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="max-w-[220px] truncate text-[12px] text-fb-muted">
            {user?.email}
          </span>
          <button
            type="button"
            onClick={() => void onLogout()}
            className="h-8 rounded-md border border-fb-border px-3 text-[12px] text-fb-text hover:bg-white/[0.06]"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col overflow-auto px-6 py-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-fb-text">
              Projects
            </h1>
            <p className="mt-1 text-[13px] text-fb-muted">
              Open a cut, or start an empty timeline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setDialogOpen(true)
            }}
            className="h-9 rounded-md bg-white px-3 text-[13px] font-medium text-black"
          >
            New Project
          </button>
        </div>

        {error && <p className="mb-4 text-[13px] text-fb-danger">{error}</p>}

        {projects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
            <h2 className="text-[18px] font-medium text-fb-text">No projects yet</h2>
            <p className="mt-2 text-[13px] text-fb-muted">Create your first project</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex min-h-[148px] flex-col rounded-lg border border-fb-border bg-fb-panel p-4"
              >
                <h2 className="truncate text-[15px] font-medium text-fb-text">
                  {project.name}
                </h2>
                <p className="mt-1 text-[12px] text-fb-subtle">
                  Updated {formatUpdated(project.updatedAt)}
                </p>
                <div className="mt-auto flex items-center gap-2 pt-6">
                  <Link
                    to="/editor/$projectId"
                    params={{ projectId: project.id }}
                    className="h-8 rounded-md bg-white px-3 text-[12px] font-medium leading-8 text-black no-underline"
                  >
                    Open
                  </Link>
                  {confirmingId === project.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void onDelete(project.id)}
                        disabled={deletingId === project.id}
                        className="h-8 px-2 text-[12px] text-fb-danger"
                      >
                        {deletingId === project.id ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="h-8 px-2 text-[12px] text-fb-muted"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(project.id)}
                      className="h-8 px-2 text-[12px] text-fb-muted hover:text-fb-text"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dialogOpen && (
        <NewProjectDialog
          creating={creating}
          onCancel={() => {
            if (creating) return
            setDialogOpen(false)
          }}
          onCreate={(project) => void onCreate(project)}
        />
      )}
    </main>
  )
}
