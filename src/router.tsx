import { isSupabaseConfigured } from '@/lib/supabase/client'
import { authRedirectLocation } from '@/features/auth/redirect'
import { AuthenticatedOutlet } from '@/features/auth/AuthenticatedOutlet'
import { authGateResult } from '@/features/auth/route-loading'
import { readAuthSession } from '@/features/auth/session'
import {
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { ProjectNotFoundError, fetchProject, listProjects } from '@/features/projects/repository'
import { AuthCallbackPage } from '@/pages/AuthCallbackPage'
import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { SignupPage } from '@/pages/SignupPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { EditorLoadError, EditorNotFound, EditorPage } from '@/pages/EditorPage'
import { JoinPage } from '@/pages/JoinPage'
import { AuthenticatedPending, RouteError } from '@/pages/RouteStates'

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
  beforeLoad: async ({ search }) => {
    const session = await readAuthSession()
    if (session) throw redirect(authRedirectLocation(search.redirect))
  },
  component: LoginPage,
})

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : '',
    error: typeof search.error === 'string' ? search.error : '',
    error_description:
      typeof search.error_description === 'string' ? search.error_description : '',
    redirect: typeof search.redirect === 'string' ? search.redirect : '',
  }),
  component: AuthCallbackPage,
})

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : '',
  }),
  beforeLoad: async ({ search }) => {
    const session = await readAuthSession()
    if (session) throw redirect(authRedirectLocation(search.redirect))
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
    const gate = authGateResult(session)
    if (gate.kind === 'redirect-login') {
      throw redirect({
        to: '/login',
        search: { redirect: location.pathname },
      })
    }
    return { userId: gate.userId }
  },
  component: AuthenticatedOutlet,
  pendingComponent: AuthenticatedPending,
  pendingMs: 0,
  pendingMinMs: 0,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

const projectsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/projects',
  loader: () => listProjects(),
  component: ProjectsPage,
  pendingComponent: AuthenticatedPending,
  pendingMs: 0,
  pendingMinMs: 0,
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
  pendingComponent: AuthenticatedPending,
  pendingMs: 0,
  pendingMinMs: 0,
  notFoundComponent: EditorNotFound,
  errorComponent: ({ error }) => <EditorLoadError error={error} />,
})

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$token',
  component: JoinPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  authCallbackRoute,
  joinRoute,
  authenticatedRoute.addChildren([projectsRoute, editorRoute]),
])

export const router = createRouter({
  routeTree,
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
