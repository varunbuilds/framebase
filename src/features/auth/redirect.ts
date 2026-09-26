import { isProjectId } from '@/features/projects/document'
import { isShareToken } from '@/features/projects/share-access'

/** Only in-app project and share routes. Anything else becomes /projects. */
export function safeAuthRedirect(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/projects'
  if (value.includes('\\') || value.includes('://')) return '/projects'

  const path = value.split(/[?#]/)[0] ?? ''
  if (path === '/projects') return '/projects'

  if (path.startsWith('/editor/')) {
    const projectId = path.slice('/editor/'.length)
    if (isProjectId(projectId) && path === `/editor/${projectId}`) {
      return path
    }
  }

  if (path.startsWith('/join/')) {
    const token = path.slice('/join/'.length)
    if (isShareToken(token) && path === `/join/${token}`) return path
  }

  return '/projects'
}

export function authRedirectLocation(value: string | null | undefined):
  | { to: '/projects' }
  | { to: '/editor/$projectId'; params: { projectId: string } }
  | { to: '/join/$token'; params: { token: string } } {
  const path = safeAuthRedirect(value)
  if (path.startsWith('/editor/')) {
    return {
      to: '/editor/$projectId' as const,
      params: { projectId: path.slice('/editor/'.length) },
    }
  }
  if (path.startsWith('/join/')) {
    return { to: '/join/$token' as const, params: { token: path.slice('/join/'.length) } }
  }
  return { to: '/projects' as const }
}

export function googleCallbackUrl(origin: string, next?: string | null): string {
  const destination = safeAuthRedirect(next)
  const callback = new URL('/auth/callback', origin)
  if (destination !== '/projects') {
    callback.searchParams.set('redirect', destination)
  }
  return callback.toString()
}

export function oauthCallbackMessage(error: string, description?: string): string {
  const text = `${error} ${description ?? ''}`.toLowerCase()
  if (
    text.includes('access_denied') ||
    text.includes('cancel') ||
    text.includes('user denied')
  ) {
    return 'Google sign-in was cancelled.'
  }
  if (text.includes('expired') || text.includes('invalid') || text.includes('code')) {
    return 'This Google sign-in link is invalid or has expired. Try again.'
  }
  return description?.trim() || 'Google sign-in failed. Try again.'
}
