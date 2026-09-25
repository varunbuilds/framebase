import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client'

export async function readAuthSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null
  const { data, error } = await getSupabase().auth.getSession()
  if (error) throw error
  return data.session
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
