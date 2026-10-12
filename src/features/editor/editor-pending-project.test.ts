import { describe, expect, it } from 'vitest'
import {
  previewAspectForSession,
  shareControlForProject,
} from './editor-pending-project'

const ownerId = '11111111-1111-4111-8111-111111111111'
const editorId = '22222222-2222-4222-8222-222222222222'
const projectId = '33333333-3333-4333-8333-333333333333'

describe('opening a project before the loader resolves', () => {
  it('does not read ownerId while the project row is still missing', () => {
    expect(() => shareControlForProject(undefined, ownerId)).not.toThrow()
    expect(shareControlForProject(undefined, ownerId)).toEqual({
      canShare: false,
      projectId: null,
    })
    expect(
      previewAspectForSession({
        structureReady: false,
        documentAspect: undefined,
        loaded: undefined,
      }),
    ).toBe('16:9')
  })

  it('keeps the ownership check once the project row is present', () => {
    const project = {
      id: projectId,
      ownerId,
      document: { canvas: { aspectRatio: '9:16' as const } },
    }
    expect(shareControlForProject(project, ownerId)).toEqual({
      canShare: true,
      projectId,
    })
    expect(shareControlForProject(project, editorId)).toEqual({
      canShare: false,
      projectId,
    })
    expect(
      previewAspectForSession({
        structureReady: false,
        documentAspect: '16:9',
        loaded: project,
      }),
    ).toBe('9:16')
    expect(
      previewAspectForSession({
        structureReady: true,
        documentAspect: '1:1',
        loaded: project,
      }),
    ).toBe('1:1')
  })
})
