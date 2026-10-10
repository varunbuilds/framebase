import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { completeOAuthCallback } from '@/features/auth/oauth-callback'
import { authRedirectLocation } from '@/features/auth/redirect'
import { getSupabase } from '@/lib/supabase/client'

export function AuthCallbackPage() {
  const { redirect } = useSearch({ from: '/auth/callback' })
  const navigate = useNavigate()
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const auth = getSupabase().auth
    void completeOAuthCallback(auth, window.location.href).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      void navigate({ ...authRedirectLocation(redirect), replace: true })
    })
    return () => {
      cancelled = true
    }
  }, [navigate, redirect])

  return (
    <AuthScreen
      title="Signing in"
      footer={
        <Link to="/login" search={{ redirect: '' }} className="app-link">
          Back to sign in
        </Link>
      }
    >
      {failure ? (
        <p className="text-[13px] text-fb-danger" role="alert">
          {failure}
        </p>
      ) : (
        <p className="text-[13px] text-fb-muted">Completing Google sign-in…</p>
      )}
    </AuthScreen>
  )
}
