import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { useAuth } from '@/features/auth/use-auth'
import { authRedirectLocation, oauthCallbackMessage } from '@/features/auth/redirect'

export function AuthCallbackPage() {
  const { error, error_description, redirect } = useSearch({
    from: '/auth/callback',
  })
  const { status } = useAuth()
  const navigate = useNavigate()
  const failure = error ? oauthCallbackMessage(error, error_description) : null
  const sessionReady = status === 'signed-in'

  useEffect(() => {
    if (failure || !sessionReady) return

    void navigate({ ...authRedirectLocation(redirect), replace: true })
  }, [failure, navigate, redirect, sessionReady])

  return (
    <AuthScreen
      title="Signing in"
      footer={
        <Link to="/login" search={{ redirect: '' }} className="text-fb-text">
          Back to sign in
        </Link>
      }
    >
      {failure || (status !== 'loading' && !sessionReady) ? (
        <p className="text-[13px] text-fb-danger" role="alert">
          {failure ?? 'Google did not return a sign-in code. Try again.'}
        </p>
      ) : (
        <p className="text-[13px] text-fb-muted">Completing Google sign-in…</p>
      )}
    </AuthScreen>
  )
}
