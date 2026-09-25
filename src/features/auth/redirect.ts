import { isProjectId } from '@/features/projects/document'

/** Only in-app project routes. Anything else, including other origins, becomes /projects. */
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

  return '/projects'
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
