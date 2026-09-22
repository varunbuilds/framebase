import type { Clip, MediaSource, ProjectDocument, Track } from '@/types/timeline'
import { createId } from '@/utils/id'

export function createDefaultTracks(): Track[] {
  return [
    {
      id: createId('track'),
      name: 'Video 1',
      kind: 'video',
      order: 0,
      muted: false,
      locked: false,
    },
    {
      id: createId('track'),
      name: 'Audio 1',
      kind: 'audio',
      order: 1,
      muted: false,
      locked: false,
    },
  ]
}

export function createEmptyProject(name = 'Untitled Project'): ProjectDocument {
  const now = new Date().toISOString()
  return {
    id: createId('project'),
    name,
    tracks: createDefaultTracks(),
    clips: [],
    mediaSources: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function touchDocument(document: ProjectDocument): ProjectDocument {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
  }
}

export function getTrackById(
  document: ProjectDocument,
  trackId: string,
): Track | undefined {
  return document.tracks.find((track) => track.id === trackId)
}

export function getClipById(
  document: ProjectDocument,
  clipId: string,
): Clip | undefined {
  return document.clips.find((clip) => clip.id === clipId)
}

export function getMediaSourceById(
  document: ProjectDocument,
  mediaSourceId: string,
): MediaSource | undefined {
  return document.mediaSources.find((source) => source.id === mediaSourceId)
}

export function getClipsForTrack(
  document: ProjectDocument,
  trackId: string,
): Clip[] {
  return document.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs)
}

export function getSortedTracks(document: ProjectDocument): Track[] {
  return [...document.tracks].sort((a, b) => a.order - b.order)
}

export function getTimelineDurationMs(document: ProjectDocument): number {
  if (document.clips.length === 0) return 10_000
  const end = document.clips.reduce((max, clip) => {
    const clipEnd = clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs)
    return Math.max(max, clipEnd)
  }, 0)
  return Math.max(10_000, end + 2_000)
}

export function serializeProject(document: ProjectDocument): string {
  return JSON.stringify(
    {
      version: 1 as const,
      document,
    },
    null,
    2,
  )
}

export function deserializeProject(json: string): ProjectDocument {
  const parsed: unknown = JSON.parse(json)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('document' in parsed) ||
    typeof (parsed as { document: unknown }).document !== 'object'
  ) {
    throw new Error('Invalid project JSON')
  }
  return (parsed as { document: ProjectDocument }).document
}
