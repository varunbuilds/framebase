import { describe, expect, it, vi } from 'vitest'
import outletSource from './AuthenticatedOutlet.tsx?raw'
import routerSource from '../../router.tsx?raw'
import projectsSource from '../../pages/ProjectsPage.tsx?raw'
import routeStatesSource from '../../pages/RouteStates.tsx?raw'
import editorSource from '../../pages/EditorPage.tsx?raw'
import {
  AUTH_SESSION_TIMEOUT_MS,
  AuthSessionTimeoutError,
  authGateResult,
  editorPendingBlocksEditing,
  editorPendingSession,
  pendingShellForPath,
  projectsBodyState,
  shouldRefreshForAccountChange,
  withTimeout,
} from './route-loading'

describe('route loading shells', () => {
  it('uses the projects shell while a session or project list is unresolved', () => {
    expect(pendingShellForPath('/projects')).toBe('projects')
    expect(pendingShellForPath('/editor/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('editor')
    expect(projectsBodyState({ routePending: true, workspaceStatus: 'ready', projectCount: 0 })).toBe(
      'skeleton',
    )
    expect(
      projectsBodyState({ routePending: false, workspaceStatus: 'restoring', projectCount: 0 }),
    ).toBe('skeleton')
    expect(projectsBodyState({ routePending: false, workspaceStatus: 'ready', projectCount: 0 })).toBe(
      'empty',
    )
    expect(projectsBodyState({ routePending: false, workspaceStatus: 'ready', projectCount: 2 })).toBe(
      'list',
    )
    expect(
      projectsBodyState({ routePending: false, workspaceStatus: 'none', projectCount: 0 }),
    ).toBe('gate')
    expect(routerSource).toContain('pendingComponent: AuthenticatedPending')
    expect(routerSource).not.toContain('SessionLoading')
    expect(routeStatesSource).not.toContain('Checking your session')
    expect(routeStatesSource).toContain('ProjectsLoadingShell')
    expect(routeStatesSource).toContain('EditorLoadingShell')
    expect(routeStatesSource).toContain('Try again')
    expect(projectsSource).toContain('ProjectCardsSkeleton')
    expect(projectsSource).toContain('projectsBodyState')
  })

  it('keeps the editor shell non-interactive until the session is ready', () => {
    expect(editorPendingBlocksEditing()).toBe(true)
    expect(editorPendingSession().structureReady).toBe(false)
    expect(routeStatesSource).toContain('editorPendingSession')
    expect(editorSource).toContain('Try again')
  })

  it('redirects when there is no session and refreshes when the account changes', () => {
    expect(authGateResult(null)).toEqual({ kind: 'redirect-login' })
    expect(authGateResult({ user: { id: 'user-1' } })).toEqual({ kind: 'allow', userId: 'user-1' })
    expect(shouldRefreshForAccountChange(null, 'user-1')).toBe(false)
    expect(shouldRefreshForAccountChange('user-1', 'user-1')).toBe(false)
    expect(shouldRefreshForAccountChange('user-1', 'user-2')).toBe(true)
    expect(routerSource).toContain("gate.kind === 'redirect-login'")
    expect(outletSource).toContain('shouldRefreshForAccountChange')
  })

  it('turns a hung session check into an error', async () => {
    vi.useFakeTimers()
    const pending = new Promise<string>(() => undefined)
    const result = withTimeout(pending, AUTH_SESSION_TIMEOUT_MS, () => new AuthSessionTimeoutError())
    const assertion = expect(result).rejects.toBeInstanceOf(AuthSessionTimeoutError)
    await vi.advanceTimersByTimeAsync(AUTH_SESSION_TIMEOUT_MS)
    await assertion
    vi.useRealTimers()
  })
})
