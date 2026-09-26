import { getSupabase } from '@/lib/supabase/client'
import { projectIdFromRoomId } from '../../../supabase/functions/_shared/project-room.ts'

/**
 * Browser half of Liveblocks authentication.
 *
 * The Liveblocks secret key only exists inside the `liveblocks-auth` Supabase
 * Edge Function. This module forwards the Supabase access token and the room
 * the editor wants to join; the function resolves the user, checks
 * public.project_members, and returns a token scoped to that one room.
 */

/** Shape Liveblocks expects back from a custom auth callback. */
export type LiveblocksAuthResult = { token: string } | { error: string; reason: string }

export function liveblocksAuthUrl(): string {
  const override = import.meta.env.VITE_LIVEBLOCKS_AUTH_URL
  if (override) return override
  const base = import.meta.env.VITE_SUPABASE_URL
  if (!base) throw new Error('Missing VITE_SUPABASE_URL')
  return `${base.replace(/\/+$/, '')}/functions/v1/liveblocks-auth`
}

/**
 * Passed to `LiveblocksProvider` as `authEndpoint`. Module scoped so the
 * identity is stable and the Liveblocks client is not recreated on re-render.
 */
export async function requestProjectRoomToken(
  room?: string,
): Promise<LiveblocksAuthResult> {
  if (!projectIdFromRoomId(room)) {
    return { error: 'forbidden', reason: 'Invalid room id.' }
  }

  const { data } = await getSupabase().auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) {
    return { error: 'forbidden', reason: 'Sign in to open this project.' }
  }

  let response: Response
  try {
    response = await fetch(liveblocksAuthUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ room }),
    })
  } catch {
    return { error: 'network', reason: 'Could not reach the collaboration service.' }
  }

  const payload = await readJson(response)
  if (!response.ok) {
    return {
      error: response.status === 403 || response.status === 401 ? 'forbidden' : 'failed',
      reason: readReason(payload) ?? 'You do not have access to this project.',
    }
  }

  const token = payload && typeof payload.token === 'string' ? payload.token : null
  if (!token) {
    return { error: 'failed', reason: 'Collaboration token was malformed.' }
  }
  return { token }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json()
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readReason(payload: Record<string, unknown> | null): string | null {
  const reason = payload?.reason ?? payload?.message
  return typeof reason === 'string' && reason ? reason : null
}
