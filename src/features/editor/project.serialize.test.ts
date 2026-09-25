import { describe, expect, it } from 'vitest'
import {
  deserializeProject,
  projectContentEqual,
  serializeProject,
} from '@/features/editor/project'
import type { ProjectDocument } from '@/types/timeline'

function sample(): ProjectDocument {
  return {
    id: 'project_1',
    name: 'Cut',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    tracks: [
      {
        id: 'track_v',
        name: 'Video 1',
        kind: 'video',
        order: 0,
        muted: false,
        locked: false,
      },
    ],
    mediaSources: [
      {
        id: 'media_1',
        name: 'interview.mp4',
        kind: 'video',
        hasVideo: true,
        hasAudio: true,
        durationMs: 8000,
        mimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        locator: { kind: 'runtime' },
        availability: 'known',
        importedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    clips: [
      {
        id: 'clip_1',
        mediaSourceId: 'media_1',
        trackId: 'track_v',
        timelineStartMs: 1000,
        sourceInMs: 200,
        sourceOutMs: 3200,
        linkGroupId: 'link_1',
        label: 'interview',
      },
    ],
  }
}

describe('project serialization', () => {
  it('round-trips a project document', () => {
    const original = sample()
    const restored = deserializeProject(serializeProject(original))
    expect(restored).toEqual(original)
  })

  it('ignores updatedAt when comparing document content', () => {
    const original = sample()
    expect(
      projectContentEqual(original, {
        ...original,
        updatedAt: '2030-01-01T00:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('rejects a clip that points at a missing media source', () => {
    const broken = sample()
    broken.clips[0] = { ...broken.clips[0]!, mediaSourceId: 'missing' }
    expect(() => deserializeProject(serializeProject(broken))).toThrow(
      /missing media source/,
    )
  })

  it('rejects an unsupported version', () => {
    const json = serializeProject(sample()).replace('"version": 1', '"version": 2')
    expect(() => deserializeProject(json)).toThrow(/version/)
  })

  it('rejects non-numeric timeline values', () => {
    const parsed = JSON.parse(serializeProject(sample())) as {
      document: { clips: Array<{ timelineStartMs: unknown }> }
    }
    parsed.document.clips[0]!.timelineStartMs = '00:01'
    expect(() => deserializeProject(JSON.stringify(parsed))).toThrow(
      /timelineStartMs/,
    )
  })
})
