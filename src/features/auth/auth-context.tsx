import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context-value'
import { authErrorMessage } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured() ? 'loading' : 'unconfigured',
  )
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    let ignore = false
    const supabase = getSupabase()

    void supabase.auth.getSession().then(({ data, error }) => {
      if (ignore) return
      if (error) {
        setSession(null)
        setStatus('signed-out')
        return
      }
      setSession(data.session)
      setStatus(data.session ? 'signed-in' : 'signed-out')
    })

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setStatus(next ? 'signed-in' : 'signed-out')
    })

    return () => {
      ignore = true
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      signIn: async (email, password) => {
        const { error } = await getSupabase().auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw new Error(authErrorMessage(error))
      },
      signUp: async (email, password) => {
        const { data, error } = await getSupabase().auth.signUp({
          email,
          password,
        })
        if (error) throw new Error(authErrorMessage(error))
        return { needsEmailConfirmation: data.session == null }
      },
      signOut: async () => {
        const { error } = await getSupabase().auth.signOut()
        if (error) throw new Error(authErrorMessage(error))
      },
    }),
    [session, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

