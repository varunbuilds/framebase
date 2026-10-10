import { oauthCallbackMessage } from './redirect'

/**
 * Production Google sign-in uses Supabase's implicit grant: the session
 * arrives in the URL fragment. A query `code` is PKCE and is only exchanged
 * when the fragment does not already contain a session.
 */
export type OAuthCallbackPlan =
  | { kind: 'implicit' }
  | { kind: 'pkce'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }

export type OAuthCallbackResult = { ok: true } | { ok: false; message: string }

type CallbackAuth = {
  getSession: () => Promise<{
    data: { session: unknown }
    error: { message: string } | null
  }>
  exchangeCodeForSession: (code: string) => Promise<{
    data: { session: unknown }
    error: { message: string } | null
  }>
}

const MISSING_SESSION = 'Google did not return a sign-in session. Try again.'

export function classifyOAuthCallback(href: string): OAuthCallbackPlan {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const error = hash.get('error') || url.searchParams.get('error')
  if (error) {
    const description = publicOAuthDetail(
      hash.get('error_description') || url.searchParams.get('error_description'),
    )
    return { kind: 'error', message: oauthCallbackMessage(error, description) }
  }
  if (hash.get('access_token') && hash.get('refresh_token')) return { kind: 'implicit' }
  const code = url.searchParams.get('code')
  if (code) return { kind: 'pkce', code }
  return { kind: 'missing' }
}

export async function completeOAuthCallback(
  auth: CallbackAuth,
  href: string,
): Promise<OAuthCallbackResult> {
  const plan = classifyOAuthCallback(href)
  if (plan.kind === 'error') return { ok: false, message: plan.message }
  if (plan.kind === 'missing') return { ok: false, message: MISSING_SESSION }
  if (plan.kind === 'pkce') {
    const { error } = await auth.exchangeCodeForSession(plan.code)
    if (error) return { ok: false, message: oauthCallbackMessage(error.message) }
    return { ok: true }
  }
  const { data, error } = await auth.getSession()
  if (error || !data.session) return { ok: false, message: MISSING_SESSION }
  return { ok: true }
}

/** Drops values that could carry a token into the visible error. */
function publicOAuthDetail(value: string | null): string | undefined {
  if (!value) return undefined
  if (/access_token|refresh_token|provider_token|bearer/i.test(value)) return undefined
  return value
}
