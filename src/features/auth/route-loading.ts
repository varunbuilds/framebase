import type { EditorSessionView } from '@/features/editor/editor-session'
import { interactionsEnabled } from '@/features/editor/editor-session'
import type { WorkspaceSnapshot } from '@/lib/workspace/workspace-types'

export class AuthSessionTimeoutError extends Error {
  constructor() {
    super('Checking your session took too long.')
    this.name = 'AuthSessionTimeoutError'
  }
}

export const AUTH_SESSION_TIMEOUT_MS = 12_000

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(createError()), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function authGateResult(
  session: { user: { id: string } } | null,
): { kind: 'allow'; userId: string } | { kind: 'redirect-login' } {
  if (!session?.user.id) return { kind: 'redirect-login' }
  return { kind: 'allow', userId: session.user.id }
}

export function shouldRefreshForAccountChange(
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  return previousUserId != null && nextUserId != null && previousUserId !== nextUserId
}

export function pendingShellForPath(pathname: string): 'editor' | 'projects' {
  return pathname.startsWith('/editor/') ? 'editor' : 'projects'
}

export type ProjectsBodyState = 'skeleton' | 'gate' | 'empty' | 'list'

/** Card skeletons cover auth, cloud fetch, and workspace restore. Empty waits until both are done. */
export function projectsBodyState(args: {
  routePending: boolean
  workspaceStatus: WorkspaceSnapshot['status']
  projectCount: number
}): ProjectsBodyState {
  if (args.routePending) return 'skeleton'
  if (args.workspaceStatus === 'restoring') return 'skeleton'
  if (args.workspaceStatus !== 'ready') return 'gate'
  if (args.projectCount === 0) return 'empty'
  return 'list'
}

export function editorPendingSession(): EditorSessionView {
  return {
    phase: 'opening',
    statusLabel: 'Opening project…',
    structureReady: false,
    interactive: false,
  }
}

export function editorPendingBlocksEditing(): boolean {
  const session = editorPendingSession()
  return session.structureReady === false && interactionsEnabled(session.phase) === false
}
