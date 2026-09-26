// Liveblocks authorization for Framebase project rooms.
//
// The browser never holds the Liveblocks secret key. It posts the room it wants
// to join together with its Supabase access token; this function resolves the
// user, confirms an owner/editor row in public.project_members, and only then
// asks Liveblocks for a token scoped to that single room.
//
// Deploy:
//   supabase secrets set LIVEBLOCKS_SECRET_KEY=sk_...
//   supabase functions deploy liveblocks-auth
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected by the platform. The
// service-role key is deliberately not used: the membership read runs as the
// caller, so row-level security is the second line of defence.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Liveblocks } from 'npm:@liveblocks/node@3'
import {
  authorizeProjectRoom,
  projectIdFromRoomId,
} from '../_shared/project-room.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '3600',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function deny(status: number, reason: string): Response {
  return json({ error: 'forbidden', reason }, status)
}

/** A display name for Liveblocks user info. Presence lands in a later milestone. */
function displayName(user: {
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}): string {
  const metadata = user.user_metadata ?? {}
  const full = metadata.full_name ?? metadata.name
  if (typeof full === 'string' && full.trim()) return full.trim()
  if (typeof user.email === 'string' && user.email) return user.email
  return 'Framebase user'
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return deny(405, 'Method not allowed.')
  }

  const secret = Deno.env.get('LIVEBLOCKS_SECRET_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!secret || !supabaseUrl || !supabaseAnonKey) {
    return json(
      { error: 'misconfigured', reason: 'Collaboration is not configured.' },
      500,
    )
  }

  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return deny(401, 'Not signed in.')
  }

  let room: unknown
  try {
    const body = (await request.json()) as { room?: unknown } | null
    room = body?.room
  } catch {
    return deny(400, 'Invalid request body.')
  }

  // Runs as the caller, so the project_members policy applies to this read.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  const user = userData?.user ?? null
  if (userError || !user) {
    return deny(401, 'Not signed in.')
  }

  // Resolve the project before touching the database so a malformed room id
  // never becomes a query.
  const projectId = projectIdFromRoomId(room)
  if (!projectId) {
    return deny(400, 'Invalid room id.')
  }

  const { data: membership, error: membershipError } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError) {
    return deny(403, 'Project access could not be verified.')
  }

  const decision = authorizeProjectRoom({
    roomId: room,
    userId: user.id,
    membershipRole: membership?.role ?? null,
  })
  if (!decision.allowed) {
    return deny(decision.status, decision.reason)
  }

  const liveblocks = new Liveblocks({ secret })
  const session = liveblocks.prepareSession(user.id, {
    userInfo: { name: displayName(user) },
  })
  session.allow(decision.roomId, session.FULL_ACCESS)
  const { status, body } = await session.authorize()

  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
