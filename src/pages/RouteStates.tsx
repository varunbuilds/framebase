import { useRouterState, useRouter } from '@tanstack/react-router'
import { AppChrome } from '@/components/layout/AppChrome'
import { EditorShell } from '@/components/layout/EditorShell'
import { ProjectCardsSkeleton } from '@/components/layout/EditorSkeletons'
import { EditorSessionProvider } from '@/features/editor/editor-session-context'
import { editorPendingSession, pendingShellForPath } from '@/features/auth/route-loading'
import logo from '@/assets/framebase-logo.png'

export function AuthenticatedPending() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  if (pendingShellForPath(pathname) === 'editor') return <EditorLoadingShell />
  return <ProjectsLoadingShell />
}

export function ProjectsLoadingShell() {
  return (
    <AppChrome className="flex h-dvh flex-col overflow-hidden">
      <header className="landing-header">
        <img className="landing-mark" src={logo} alt="" />
      </header>
      <div
        className="relative z-[1] mx-auto flex w-full max-w-[1080px] flex-1 flex-col overflow-auto px-9 pb-8 pt-[88px]"
        aria-busy="true"
      >
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-[40px] font-bold leading-none tracking-[-0.04em] text-[#f4f4f4]">
              Projects
            </h1>
            <button type="button" disabled className="app-btn">
              New Project
            </button>
          </div>
          <p className="mt-3 text-[15px] text-[rgba(243,244,244,0.72)]">
            Open a cut, or start an empty timeline.
          </p>
        </div>
        <ProjectCardsSkeleton />
      </div>
    </AppChrome>
  )
}

export function EditorLoadingShell() {
  return (
    <EditorSessionProvider value={editorPendingSession()}>
      <EditorShell />
    </EditorSessionProvider>
  )
}

export function RouteError({ error }: { error: unknown }) {
  const router = useRouter()
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return (
    <AppChrome>
      <main className="relative z-[1] grid h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-[32px] font-bold tracking-[-0.04em] text-[#f4f4f4]">
            Something went wrong
          </h1>
          <p className="mt-3 max-w-[42ch] text-[14px] text-fb-danger">{message}</p>
          <button type="button" className="app-btn mt-8" onClick={() => void router.invalidate()}>
            Try again
          </button>
        </div>
      </main>
    </AppChrome>
  )
}
