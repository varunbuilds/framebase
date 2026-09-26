import { describe, expect, it } from 'vitest'
import {
  authorizeProjectRoom,
  FRAMEBASE_ROOM_PREFIX,
  isProjectUuid,
  projectIdFromRoomId,
  projectRoomId,
} from '../../../supabase/functions/_shared/project-room.ts'

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const ROOM = `${FRAMEBASE_ROOM_PREFIX}${PROJECT_ID}`

describe('project room identity', () => {
  it('builds one room per project and rejects anything else', () => {
    expect(projectRoomId(PROJECT_ID)).toBe(ROOM)
    expect(projectIdFromRoomId(ROOM)).toBe(PROJECT_ID)
    expect(projectIdFromRoomId(PROJECT_ID)).toBeNull()
    expect(projectIdFromRoomId('framebase:not-a-uuid')).toBeNull()
    expect(projectIdFromRoomId('other:project')).toBeNull()
    expect(projectIdFromRoomId('')).toBeNull()
    expect(projectIdFromRoomId(null)).toBeNull()
    expect(isProjectUuid(PROJECT_ID)).toBe(true)
    expect(isProjectUuid('framebase:' + PROJECT_ID)).toBe(false)
    expect(() => projectRoomId('not-a-uuid')).toThrow(/Invalid project id/)
  })
})

describe('project room authorization', () => {
  it('rejects an unauthenticated caller', () => {
    expect(
      authorizeProjectRoom({
        roomId: ROOM,
        userId: null,
        membershipRole: 'owner',
      }),
    ).toEqual({ allowed: false, status: 401, reason: 'Not signed in.' })
    expect(
      authorizeProjectRoom({
        roomId: ROOM,
        userId: '',
        membershipRole: 'editor',
      }),
    ).toEqual({ allowed: false, status: 401, reason: 'Not signed in.' })
  })

  it('rejects a user who is not a project member', () => {
    expect(
      authorizeProjectRoom({
        roomId: ROOM,
        userId: USER_ID,
        membershipRole: null,
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: 'Not a member of this project.',
    })
    expect(
      authorizeProjectRoom({
        roomId: ROOM,
        userId: USER_ID,
        membershipRole: 'viewer',
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: 'Not a member of this project.',
    })
    expect(
      authorizeProjectRoom({
        roomId: ROOM,
        userId: USER_ID,
        membershipRole: 'admin',
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: 'Not a member of this project.',
    })
  })

  it('rejects a known project id that is not a room id', () => {
    expect(
      authorizeProjectRoom({
        roomId: PROJECT_ID,
        userId: USER_ID,
        membershipRole: 'owner',
      }),
    ).toEqual({ allowed: false, status: 400, reason: 'Invalid room id.' })
  })

  it('allows the existing owner and editor memberships', () => {
    expect(
      authorizeProjectRoom({
        roomId: ROOM,
        userId: USER_ID,
        membershipRole: 'owner',
      }),
    ).toEqual({
      allowed: true,
      projectId: PROJECT_ID,
      roomId: ROOM,
      role: 'owner',
    })
    expect(
      authorizeProjectRoom({
        roomId: ROOM,
        userId: USER_ID,
        membershipRole: 'editor',
      }),
    ).toEqual({
      allowed: true,
      projectId: PROJECT_ID,
      roomId: ROOM,
      role: 'editor',
    })
  })

  it('does not grant access merely because the project id is known', () => {
    const decision = authorizeProjectRoom({
      roomId: projectRoomId(PROJECT_ID),
      userId: USER_ID,
      membershipRole: null,
    })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.status).toBe(403)
  })
})
