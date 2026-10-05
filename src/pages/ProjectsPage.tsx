import { getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { WorkspaceAccess } from '@/components/projects/WorkspaceAccess'
import { AppChrome } from '@/components/layout/AppChrome'
import logo from '@/assets/framebase-logo.png'
import { useAuth } from '@/features/auth/use-auth'
import { releaseProjectMedia } from '@/lib/media/release-project-media'
import { deleteProjectCloudMedia } from '@/lib/media/publish-source'
import { mirrorCurrentProject } from '@/lib/workspace/workspace-manager'
import { useWorkspace } from '@/lib/workspace/use-workspace'
import { showsProjectLibrary } from '@/lib/workspace/project-library'
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
  const workspace = useWorkspace()
  const library = showsProjectLibrary(workspace.status)
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
  const [signOpen, setSignOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const placeSignBox = (event: { currentTarget: HTMLDivElement }) => {
    const root = rootRef.current
    const link = event.currentTarget.querySelector('a, button')
    if (!root || !(link instanceof HTMLElement)) return
    const frame = root.getBoundingClientRect()
    const box = link.getBoundingClientRect()
    root.style.setProperty('--sign-top', `${box.top - frame.top}px`)
    root.style.setProperty('--sign-right', `${frame.right - box.right}px`)
    root.style.setProperty('--sign-width', `${box.width}px`)
    root.style.setProperty('--sign-height', `${box.height}px`)
    setSignOpen(true)
  }

  const onCreate = async (project: {
    name: string
    aspectRatio: CanvasAspectRatio
  }) => {
    if (!user || creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await createProject(user.id, project)
      await mirrorCurrentProject(created.document).catch(() => undefined)
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
        throw caught
      }
      if (document) await deleteProjectCloudMedia(document)
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
    <AppChrome className="flex h-dvh flex-col overflow-hidden" signOpen={signOpen} rootRef={rootRef}>
      <header className="landing-header">
        <img
          className="landing-mark"
          src={logo}
          alt=""
          role="link"
          tabIndex={0}
          onClick={() => void navigate({ to: '/' })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              void navigate({ to: '/' })
            }
          }}
        />
        <div
          className="landing-contact"
          onPointerEnter={placeSignBox}
          onPointerLeave={() => setSignOpen(false)}
          onFocusCapture={placeSignBox}
          onBlurCapture={() => setSignOpen(false)}
        >
          <button type="button" className="landing-contact-link" onClick={() => void onLogout()}>
            Log out
          </button>
        </div>
      </header>

      <div className="relative z-[1] mx-auto flex w-full max-w-[1080px] flex-1 flex-col overflow-auto px-9 pb-8 pt-[88px]">
        <WorkspaceAccess />

        {library ? (
          <>
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[40px] font-bold leading-none tracking-[-0.04em] text-[#f4f4f4]">
              Projects
            </h1>
            <p className="mt-3 text-[15px] text-[rgba(243,244,244,0.72)]">
              Open a cut, or start an empty timeline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setDialogOpen(true)
            }}
            className="app-btn"
          >
            New Project
          </button>
        </div>

        {error && <p className="mb-4 text-[13px] text-fb-danger">{error}</p>}

        {projects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
            <h2 className="text-[18px] font-semibold text-[#f4f4f4]">No projects yet</h2>
            <p className="mt-2 text-[14px] text-[rgba(243,244,244,0.72)]">Create your first project</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id} className="app-panel flex min-h-[148px] flex-col p-4">
                <h2 className="truncate text-[15px] font-semibold text-[#f4f4f4]">
                  {project.name}
                </h2>
                <p className="mt-1 text-[12px] text-[rgba(243,244,244,0.55)]">
                  Updated {formatUpdated(project.updatedAt)}
                </p>
                <div className="mt-auto flex items-center gap-2 pt-6">
                  <Link
                    to="/editor/$projectId"
                    params={{ projectId: project.id }}
                    className="app-btn h-8 text-[12px]"
                  >
                    Open
                  </Link>
                  {user?.id === project.ownerId && confirmingId === project.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void onDelete(project.id)}
                        disabled={deletingId === project.id}
                        className="app-btn-quiet text-fb-danger"
                      >
                        {deletingId === project.id ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="app-btn-quiet"
                      >
                        Cancel
                      </button>
                    </>
                  ) : user?.id === project.ownerId ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(project.id)}
                      className="app-btn-quiet"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
          </>
        ) : null}
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
    </AppChrome>
  )
}
