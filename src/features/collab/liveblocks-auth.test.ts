import { afterEach, describe, expect, it, vi } from 'vitest'
import { FRAMEBASE_ROOM_PREFIX } from '../../../supabase/functions/_shared/project-room.ts'

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'
const ROOM = `${FRAMEBASE_ROOM_PREFIX}${PROJECT_ID}`

const getSession = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    auth: { getSession },
  }),
}))

import { liveblocksAuthUrl, requestProjectRoomToken } from './liveblocks-auth'

describe('Liveblocks auth client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    getSession.mockReset()
  })

  it('builds the auth URL from Supabase and never embeds a secret key', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co/')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    expect(liveblocksAuthUrl()).toBe(
      'https://proj.supabase.co/functions/v1/liveblocks-auth',
    )
    expect(liveblocksAuthUrl()).not.toMatch(/sk_/)
  })

  it('rejects a malformed room before talking to the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const missing = await requestProjectRoomToken()
    const bareId = await requestProjectRoomToken(PROJECT_ID)
    const garbage = await requestProjectRoomToken('not-a-room')

    expect(missing).toEqual({ error: 'forbidden', reason: 'Invalid room id.' })
    expect(bareId).toEqual({ error: 'forbidden', reason: 'Invalid room id.' })
    expect(garbage).toEqual({ error: 'forbidden', reason: 'Invalid room id.' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })

  it('rejects a signed-out user without calling the auth function', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestProjectRoomToken(ROOM)

    expect(result).toEqual({
      error: 'forbidden',
      reason: 'Sign in to open this project.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards a membership rejection from the auth endpoint', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    getSession.mockResolvedValue({
      data: { session: { access_token: 'user-jwt' } },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ reason: 'Not a member of this project.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await requestProjectRoomToken(ROOM)

    expect(result).toEqual({
      error: 'forbidden',
      reason: 'Not a member of this project.',
    })
  })

  it('returns the issued token when membership is confirmed', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    getSession.mockResolvedValue({
      data: { session: { access_token: 'user-jwt' } },
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://proj.supabase.co/functions/v1/liveblocks-auth')
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer user-jwt',
        apikey: 'anon-key',
      })
      expect(JSON.parse(String(init?.body))).toEqual({ room: ROOM })
      return new Response(JSON.stringify({ token: 'lb-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestProjectRoomToken(ROOM)).resolves.toEqual({
      token: 'lb-token',
    })
  })
})
