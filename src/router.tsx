import {
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { readAuthSession } from '@/features/auth/session'
import { ProjectNotFoundError, fetchProject, listProjects } from '@/features/projects/repository'
import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { SignupPage } from '@/pages/SignupPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { EditorLoadError, EditorNotFound, EditorPage } from '@/pages/EditorPage'
import { RouteError, SessionLoading } from '@/pages/RouteStates'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : '',
  }),
  beforeLoad: async () => {
    const session = await readAuthSession()
    if (session) throw redirect({ to: '/projects' })
  },
  component: LoginPage,
})

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  beforeLoad: async () => {
    const session = await readAuthSession()
    if (session) throw redirect({ to: '/projects' })
  },
  component: SignupPage,
})

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  beforeLoad: async ({ location }) => {
    if (!isSupabaseConfigured()) {
      throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
    }
    const session = await readAuthSession()
    if (!session) {
      throw redirect({
        to: '/login',
        search: { redirect: location.pathname },
      })
    }
    return { userId: session.user.id }
  },
  pendingComponent: SessionLoading,
  pendingMs: 0,
})

const projectsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/projects',
  loader: () => listProjects(),
  component: ProjectsPage,
  pendingComponent: SessionLoading,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

const editorRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/editor/$projectId',
  loader: async ({ params }) => {
    try {
      return await fetchProject(params.projectId)
    } catch (error) {
      if (error instanceof ProjectNotFoundError) throw notFound()
      throw error
    }
  },
  component: EditorPage,
  pendingComponent: SessionLoading,
  notFoundComponent: EditorNotFound,
  errorComponent: ({ error }) => <EditorLoadError error={error} />,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  authenticatedRoute.addChildren([projectsRoute, editorRoute]),
])

export const router = createRouter({
  routeTree,
  defaultPendingMs: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
