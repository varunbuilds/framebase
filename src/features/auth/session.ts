import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { AUTH_SESSION_TIMEOUT_MS, AuthSessionTimeoutError, withTimeout } from './route-loading'

export async function readAuthSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null
  const result = await withTimeout(
    getSupabase().auth.getSession(),
    AUTH_SESSION_TIMEOUT_MS,
    () => new AuthSessionTimeoutError(),
  )
  if (result.error) throw result.error
  return result.data.session
}

export function authErrorMessage(error: { message: string }): string {
  const message = error.message.toLowerCase()
  if (message.includes('invalid login') || message.includes('invalid credentials')) {
    return 'Email or password is incorrect.'
  }
  if (
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('user already')
  ) {
    return 'An account with this email already exists.'
  }
  if (message.includes('password')) {
    return error.message
  }
  return error.message
}
