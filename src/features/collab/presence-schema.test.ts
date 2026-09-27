import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import type { ProjectDocument } from '@/types/timeline'
import {
  clearCollaboratorDirectory,
  rememberCollaborators,
  resolveFramebaseUsers,
} from './collaborator-directory'
import {
  EMPTY_EDITOR_PRESENCE,
  clearSelectedClip,
  collaboratorsOnClip,
  colorForUserId,
  presenceLeavesDocument,
  setActiveArea,
  setCursor,
  setSelectedClip,
  type PresenceSelection,
} from './presence-schema'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function document(): ProjectDocument {
  const base = createEmptyProject('Cut', PROJECT_ID)
  return {
    ...base,
    clips: [
      {
        id: 'clip_1',
        mediaSourceId: 'media_1',
        trackId: 'track_1',
        timelineStartMs: 0,
        sourceInMs: 0,
        sourceOutMs: 1_000,
      },
    ],
  }
}

function person(
  connectionId: number,
  selectedClipId: string | null,
  name = `Person ${connectionId}`,
): PresenceSelection {
  return {
    connectionId,
    userId: `user_${connectionId}`,
    name,
    selectedClipId,
  }
}

describe('editor presence', () => {
  it('starts with no cursor, selection, or active area', () => {
    expect(EMPTY_EDITOR_PRESENCE).toEqual({
      cursor: null,
      selectedClipId: null,
      activeArea: null,
    })
  })

  it('sets and clears the selected clip without touching the document', () => {
    const current = document()
    const before = structuredClone(current)
    const selected = setSelectedClip(EMPTY_EDITOR_PRESENCE, 'clip_1')
    const cleared = clearSelectedClip(selected)
    const held = presenceLeavesDocument(current, selected)

    expect(selected.selectedClipId).toBe('clip_1')
    expect(cleared.selectedClipId).toBeNull()
    expect(held.document).toBe(current)
    expect(current).toEqual(before)
    expect(JSON.stringify(current)).not.toContain('selectedClipId')
  })

  it('records cursor presence and clears it when the pointer leaves', () => {
    const moved = setCursor(EMPTY_EDITOR_PRESENCE, { x: 0.25, y: 0.5 })
    const gone = setCursor(moved, null)

    expect(moved.cursor).toEqual({ x: 0.25, y: 0.5 })
    expect(gone.cursor).toBeNull()
    expect(moved.selectedClipId).toBeNull()
  })

  it('keeps a stable color for a user id', () => {
    expect(colorForUserId('user_a')).toBe(colorForUserId('user_a'))
    expect(colorForUserId('user_a')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('filters collaborators to the people selecting one clip', () => {
    const others = [
      person(1, 'clip_1', 'Ada'),
      person(2, 'clip_2', 'Bea'),
      person(3, null, 'Cy'),
      person(4, 'clip_1', 'Dan'),
    ]

    const onFirst = collaboratorsOnClip(others, 'clip_1')
    const onSecond = collaboratorsOnClip(others, 'clip_2')
    const onMissing = collaboratorsOnClip(others, 'clip_missing')

    expect(onFirst.map((item) => item.name)).toEqual(['Ada', 'Dan'])
    expect(onFirst.map((item) => item.connectionId)).toEqual([1, 4])
    expect(onFirst.every((item) => item.selectedClipId === 'clip_1')).toBe(true)
    expect(onSecond.map((item) => item.name)).toEqual(['Bea'])
    expect(onMissing).toEqual([])
  })

  it('lets several people select the same clip', () => {
    const marks = collaboratorsOnClip(
      [person(7, 'clip_shared', 'Ada'), person(8, 'clip_shared', 'Bea')],
      'clip_shared',
    )
    expect(marks).toHaveLength(2)
    expect(marks.map((item) => item.selectedClipId)).toEqual(['clip_shared', 'clip_shared'])
    expect(marks.map((item) => item.color)).toEqual([
      colorForUserId('user_7'),
      colorForUserId('user_8'),
    ])
  })

  it('does not copy presence into the project document when the active area changes', () => {
    const current = document()
    const snapshot = structuredClone(current)
    const next = setActiveArea(setCursor(EMPTY_EDITOR_PRESENCE, { x: 0.1, y: 0.2 }), 'timeline')
    const held = presenceLeavesDocument(current, next)

    expect(held.presence).toEqual({
      cursor: { x: 0.1, y: 0.2 },
      selectedClipId: null,
      activeArea: 'timeline',
    })
    expect(held.document).toEqual(snapshot)
    expect(Object.keys(held.document)).not.toContain('cursor')
  })
})

describe('collaborator identity', () => {
  it('resolves a remembered Supabase name and a stable color', () => {
    clearCollaboratorDirectory()
    expect(rememberCollaborators([{ id: 'user_a', name: 'Ada Lovelace' }])).toBe(true)
    expect(rememberCollaborators([{ id: 'user_a', name: 'Ada Lovelace' }])).toBe(false)

    expect(resolveFramebaseUsers({ userIds: ['user_a', 'user_unknown'] })).toEqual([
      { name: 'Ada Lovelace', color: colorForUserId('user_a') },
      { name: 'Collaborator', color: colorForUserId('user_unknown') },
    ])
  })
})
