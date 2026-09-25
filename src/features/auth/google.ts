import { getSupabase } from '@/lib/supabase/client'
import { authErrorMessage } from './session'
import { googleCallbackUrl } from './redirect'

/** Starts Supabase's Google OAuth redirect. Credentials stay in the Supabase dashboard. */
export async function signInWithGoogle(next?: string | null): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: googleCallbackUrl(window.location.origin, next),
      queryParams: {
        prompt: 'select_account',
      },
    },
  })
  if (error) throw new Error(authErrorMessage(error))
}
