import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import { resolvePlaybackAt } from '@/features/editor/playback'
import {
  pausedPlaybackFollowsChange,
  pausedPreviewStep,
} from '@/features/editor/use-timeline-playback'
import { useEditorStore } from '@/stores/editor-store'
import type { ProjectDocument } from '@/types/timeline'

function withClip(document: ProjectDocument): ProjectDocument {
  const video = document.tracks.find((track) => track.kind === 'video')
  if (!video) throw new Error('expected a video track')
  return {
    ...document,
    mediaSources: [
      {
        id: 'media_1',
        name: 'clip.mp4',
        kind: 'video',
        hasVideo: true,
        hasAudio: false,
        durationMs: 2000,
        mimeType: 'video/mp4',
        locator: { kind: 'local', key: 'media_1' },
        availability: 'known',
        importedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    clips: [
      {
        id: 'clip_1',
        mediaSourceId: 'media_1',
        trackId: video.id,
        timelineStartMs: 0,
        sourceInMs: 0,
        sourceOutMs: 2000,
      },
    ],
  }
}

function snapshot(state: ReturnType<typeof useEditorStore.getState>) {
  return {
    document: state.document,
    playheadMs: state.ui.playheadMs,
    isPlaying: state.ui.isPlaying,
    seekVersion: state.ui.seekVersion,
  }
}

afterEach(() => {
  useEditorStore.getState().endEditingSession()
})

describe('paused playback while the editor is loading', () => {
  it('stays idle when the project has no media', () => {
    const document = createEmptyProject('Cut', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const resolution = resolvePlaybackAt(document, 0)
    expect(resolution.status).toBe('empty')
    expect(
      pausedPreviewStep({
        status: resolution.status,
        hasMediaElement: true,
        hasObjectUrl: false,
      }),
    ).toBe('idle')
  })

  it('waits when clips exist but the source is not hydrated', () => {
    const document = withClip(
      createEmptyProject('Cut', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    )
    const resolution = resolvePlaybackAt(document, 0)
    expect(resolution.status).toBe('clip')
    expect(
      pausedPreviewStep({
        status: resolution.status,
        hasMediaElement: true,
        hasObjectUrl: false,
      }),
    ).toBe('not-ready')
  })

  it('waits while a media source is still loading', () => {
    expect(
      pausedPreviewStep({
        status: 'clip',
        hasMediaElement: true,
        hasObjectUrl: false,
      }),
    ).toBe('not-ready')
  })

  it('stays idle when no clip is active', () => {
    const document = withClip(
      createEmptyProject('Cut', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    )
    const resolution = resolvePlaybackAt(document, 4000)
    expect(resolution.status === 'clip').toBe(false)
    expect(
      pausedPreviewStep({
        status: resolution.status,
        hasMediaElement: true,
        hasObjectUrl: false,
      }),
    ).toBe('idle')
  })

  it('does not re-enter paused sync when recording a playback error', () => {
    const document = withClip(
      createEmptyProject('Cut', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    )
    useEditorStore.getState().loadDocument(document, null)
    useEditorStore.getState().setIsPlaying(true)

    let entries = 0
    const stop = useEditorStore.subscribe((state, previous) => {
      if (!pausedPlaybackFollowsChange(snapshot(previous), snapshot(state))) return
      entries += 1
      if (entries > 2) throw new Error('paused sync re-entered')
      const resolution = resolvePlaybackAt(state.document, state.ui.playheadMs)
      const step = pausedPreviewStep({
        status: resolution.status,
        hasMediaElement: true,
        hasObjectUrl: false,
      })
      expect(step).toBe('not-ready')
      useEditorStore.getState().setPlaybackError('Media file is unavailable for the active clip.')
    })

    useEditorStore.getState().setPlaybackError('Media file is unavailable for the active clip.')
    stop()
    expect(entries).toBe(1)
    expect(useEditorStore.getState().ui.isPlaying).toBe(false)
    expect(useEditorStore.getState().ui.playbackError).toBe(
      'Media file is unavailable for the active clip.',
    )
  })
})
