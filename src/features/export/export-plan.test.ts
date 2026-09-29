import { describe, expect, it } from 'vitest'
import { resolveActiveVideoClip } from '@/features/editor/playback'
import type { Clip, MediaSource, ProjectDocument, Track } from '@/types/timeline'
import {
  audioExportEncoding,
  mp4ExportBlocker,
  videoExportEncoding,
  type Mp4EncodeProbe,
} from './export-capabilities'
import { reportExportError } from './export-log'
import {
  audioSpansForExport,
  clampPcm,
  emptyTimelineMessage,
  exportDurationMs,
  exportFilename,
  exportFrameCount,
  exportFrameWindow,
  exportSizeFor,
  mixIntoTimeline,
  placedAudioTimelineMs,
  pictureAt,
  reduceExportJob,
  requiredMediaSources,
  snapshotProject,
  timelineSampleOffset,
  unavailableMedia,
  unavailableMediaMessage,
} from './export-plan'
import type { ExportJob } from './export-types'

function track(partial: Pick<Track, 'id' | 'name' | 'kind' | 'order'> & Partial<Pick<Track, 'muted'>>): Track {
  return { muted: false, locked: false, ...partial }
}

function media(
  partial: Pick<MediaSource, 'id' | 'name' | 'kind' | 'durationMs'> &
    Partial<Pick<MediaSource, 'hasVideo' | 'hasAudio' | 'availability'>>,
): MediaSource {
  return {
    mimeType: partial.kind === 'video' ? 'video/mp4' : 'audio/mpeg',
    locator: { kind: 'local', key: partial.id },
    availability: partial.availability ?? 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
    hasVideo: partial.hasVideo ?? partial.kind === 'video',
    hasAudio: partial.hasAudio ?? partial.kind === 'audio',
    ...partial,
  }
}

function clip(partial: Clip): Clip {
  return partial
}

function project(parts: {
  name?: string
  aspect?: ProjectDocument['canvas']['aspectRatio']
  tracks: Track[]
  clips: Clip[]
  mediaSources: MediaSource[]
}): ProjectDocument {
  return {
    id: 'project_1',
    name: parts.name ?? 'Cut',
    canvas: { aspectRatio: parts.aspect ?? '16:9' },
    tracks: parts.tracks,
    clips: parts.clips,
    mediaSources: parts.mediaSources,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const video = track({ id: 'v1', name: 'Video 1', kind: 'video', order: 0 })
const audio = track({ id: 'a1', name: 'Audio 1', kind: 'audio', order: 1 })
const source = media({
  id: 'm1',
  name: 'interview.mp4',
  kind: 'video',
  durationMs: 20_000,
  hasVideo: true,
  hasAudio: true,
})

describe('export snapshot', () => {
  it('is a frozen copy that does not follow later document edits', () => {
    const current = project({
      tracks: [video, audio],
      clips: [
        clip({
          id: 'c1',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 0,
          sourceInMs: 5_000,
          sourceOutMs: 12_000,
        }),
      ],
      mediaSources: [source],
    })

    const snapshot = snapshotProject(current)
    current.clips[0]!.timelineStartMs = 9_000
    current.name = 'Edited live'

    expect(snapshot).not.toBe(current)
    expect(snapshot.clips[0]).not.toBe(current.clips[0])
    expect(snapshot.clips[0]?.timelineStartMs).toBe(0)
    expect(snapshot.clips[0]?.sourceInMs).toBe(5_000)
    expect(snapshot.clips[0]?.sourceOutMs).toBe(12_000)
    expect(snapshot.name).toBe('Cut')
    expect(current).toEqual({
      ...snapshot,
      name: 'Edited live',
      clips: [{ ...snapshot.clips[0], timelineStartMs: 9_000 }],
    })
    expect(() => {
      snapshot.clips[0]!.timelineStartMs = 1
    }).toThrow(TypeError)
  })
})

describe('export frame', () => {
  it('maps aspect ratio to a default resolution', () => {
    expect(exportSizeFor('16:9')).toMatchObject({ width: 1920, height: 1080, label: '1920 × 1080' })
    expect(exportSizeFor('9:16')).toMatchObject({ width: 1080, height: 1920 })
    expect(exportSizeFor('1:1')).toMatchObject({ width: 1080, height: 1080 })
    expect(exportSizeFor('4:3')).toMatchObject({ width: 1440, height: 1080 })
  })

  it('maps a trimmed clip through source in and out', () => {
    const document = project({
      tracks: [video],
      clips: [
        clip({
          id: 'c1',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 2_000,
          sourceInMs: 5_000,
          sourceOutMs: 12_000,
        }),
      ],
      mediaSources: [source],
    })

    expect(exportDurationMs(document)).toBe(9_000)
    expect(pictureAt(document, 0)).toEqual({ kind: 'gap' })
    expect(pictureAt(document, 2_000)).toMatchObject({
      kind: 'frame',
      clipId: 'c1',
      sourceTimeMs: 5_000,
    })
    expect(pictureAt(document, 4_000)).toMatchObject({
      kind: 'frame',
      sourceTimeMs: 7_000,
    })
    expect(pictureAt(document, 9_000).kind).toBe('gap')
    expect(resolveActiveVideoClip(document, 4_000)?.sourceTimeMs).toBe(7_000)
  })

  it('keeps the gap before a clip that starts later', () => {
    const document = project({
      tracks: [video],
      clips: [
        clip({
          id: 'c1',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 3_000,
          sourceInMs: 0,
          sourceOutMs: 1_000,
        }),
      ],
      mediaSources: [source],
    })

    expect(exportDurationMs(document)).toBe(4_000)
    expect(pictureAt(document, 0).kind).toBe('gap')
    expect(pictureAt(document, 2_999).kind).toBe('gap')
    expect(pictureAt(document, 3_000).kind).toBe('frame')
    expect(exportFrameCount(4_000)).toBe(120)
    expect(exportFrameWindow(0, 120, 4_000).timelineMs).toBe(0)
  })

  it('uses the foreground video clip, matching playback', () => {
    const above = track({ id: 'v2', name: 'Video 2', kind: 'video', order: -1 })
    const document = project({
      tracks: [video, above],
      clips: [
        clip({
          id: 'lower',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 0,
          sourceInMs: 0,
          sourceOutMs: 5_000,
        }),
        clip({
          id: 'front',
          mediaSourceId: 'm1',
          trackId: 'v2',
          timelineStartMs: 0,
          sourceInMs: 1_000,
          sourceOutMs: 2_000,
        }),
      ],
      mediaSources: [source],
    })

    const atFront = pictureAt(document, 100)
    expect(atFront.kind === 'frame' ? atFront.clipId : null).toBe(
      resolveActiveVideoClip(document, 100)?.clip.id,
    )
    expect(pictureAt(document, 100)).toMatchObject({ kind: 'frame', clipId: 'front', sourceTimeMs: 1_100 })
    expect(pictureAt(document, 2_500)).toMatchObject({ kind: 'frame', clipId: 'lower' })
  })

  it('places unmuted audio at its timeline start and honors mute', () => {
    const muted = track({ id: 'a2', name: 'Muted', kind: 'audio', order: 2, muted: true })
    const document = project({
      tracks: [video, audio, muted],
      clips: [
        clip({
          id: 'picture',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 1_000,
          sourceInMs: 0,
          sourceOutMs: 2_000,
        }),
        clip({
          id: 'voice',
          mediaSourceId: 'm1',
          trackId: 'a1',
          timelineStartMs: 1_000,
          sourceInMs: 5_000,
          sourceOutMs: 7_000,
        }),
        clip({
          id: 'hidden',
          mediaSourceId: 'voice',
          trackId: 'a2',
          timelineStartMs: 0,
          sourceInMs: 0,
          sourceOutMs: 500,
        }),
      ],
      mediaSources: [
        source,
        media({ id: 'voice', name: 'room.wav', kind: 'audio', durationMs: 4_000 }),
      ],
    })

    expect(audioSpansForExport(document)).toEqual([
      {
        mediaSourceId: 'm1',
        mediaName: 'interview.mp4',
        timelineStartMs: 1_000,
        sourceInMs: 5_000,
        sourceOutMs: 7_000,
      },
    ])
    expect(timelineSampleOffset(1_000)).toBe(48_000)
  })

  it('keeps video-file audio when no audio-track clip owns that source', () => {
    const document = project({
      tracks: [video],
      clips: [
        clip({
          id: 'picture',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 500,
          sourceInMs: 100,
          sourceOutMs: 1_100,
        }),
      ],
      mediaSources: [source],
    })

    expect(audioSpansForExport(document)).toEqual([
      {
        mediaSourceId: 'm1',
        mediaName: 'interview.mp4',
        timelineStartMs: 500,
        sourceInMs: 100,
        sourceOutMs: 1_100,
      },
    ])
  })
})

describe('export media and filename', () => {
  it('reports required media that is not available', () => {
    const gone = media({
      id: 'm1',
      name: 'interview.mp4',
      kind: 'video',
      durationMs: 1_000,
      availability: 'missing',
    })
    const document = project({
      tracks: [video],
      clips: [
        clip({
          id: 'c1',
          mediaSourceId: 'm1',
          trackId: 'v1',
          timelineStartMs: 0,
          sourceInMs: 0,
          sourceOutMs: 1_000,
        }),
      ],
      mediaSources: [gone],
    })

    expect(requiredMediaSources(document).map((item) => item.id)).toEqual(['m1'])
    expect(unavailableMedia(document, () => false)).toEqual([gone])
    expect(unavailableMediaMessage([{ name: 'interview.mp4' }])).toBe(
      "Export can't start because 1 media file is unavailable: interview.mp4.",
    )
    expect(unavailableMedia(document, (id) => id === 'm1')).toEqual([])
  })

  it('sanitizes the project name into an mp4 filename', () => {
    expect(exportFilename('Cut 01')).toBe('Cut 01.mp4')
    expect(exportFilename('A/B:C*')).toBe('A B C.mp4')
    expect(exportFilename('   ')).toBe('Untitled.mp4')
    expect(exportFilename('Rough.')).toBe('Rough.mp4')
    expect(exportFilename('A\u0000B')).toBe('A B.mp4')
    expect(emptyTimelineMessage()).toBe("Export can't start because the timeline is empty.")
  })
})

describe('export job', () => {
  it('cancels an in-progress export and ignores later progress', () => {
    let job: ExportJob = { status: 'idle' }
    job = reduceExportJob(job, { type: 'start' })
    expect(job).toEqual({ status: 'preparing' })
    job = reduceExportJob(job, {
      type: 'progress',
      progress: { phase: 'rendering', fraction: 0.32 },
    })
    expect(job).toEqual({ status: 'rendering', percent: 32 })
    job = reduceExportJob(job, { type: 'cancel' })
    expect(job).toEqual({ status: 'canceled' })
    job = reduceExportJob(job, {
      type: 'progress',
      progress: { phase: 'rendering', fraction: 0.9 },
    })
    job = reduceExportJob(job, { type: 'complete', filename: 'Cut.mp4' })
    expect(job).toEqual({ status: 'canceled' })

    job = reduceExportJob(job, { type: 'start' })
    expect(job).toEqual({ status: 'preparing' })
    job = reduceExportJob(job, {
      type: 'progress',
      progress: { phase: 'finalizing', fraction: 1 },
    })
    expect(job.status).toBe('finalizing')
    job = reduceExportJob(job, { type: 'complete', filename: 'Cut.mp4' })
    expect(job).toEqual({ status: 'complete', filename: 'Cut.mp4' })
  })

  it('fails with the provided message and can be reset', () => {
    let job: ExportJob = reduceExportJob({ status: 'idle' }, { type: 'start' })
    job = reduceExportJob(job, {
      type: 'fail',
      message: 'Export failed.',
      detail: 'TypeError: config.quality and config.bitrate cannot both be provided.',
    })
    expect(job).toEqual({
      status: 'failed',
      message: 'Export failed.',
      detail: 'TypeError: config.quality and config.bitrate cannot both be provided.',
    })
    expect(reduceExportJob(job, { type: 'reset' })).toEqual({ status: 'idle' })
  })
})

describe('audio placement', () => {
  it('keeps a leading gap as silence before the clip', () => {
    const placed = placedAudioTimelineMs({
      timelineStartMs: 5_000,
      sourceInMs: 0,
      sampleTimestampSec: 0,
    })
    expect(placed).toBe(5_000)
    const gapSamples = timelineSampleOffset(placed)
    const destination = new Float32Array(gapSamples + 2)
    mixIntoTimeline({
      destination,
      source: new Float32Array([0.4, 0.4]),
      sourceRate: 48_000,
      destinationRate: 48_000,
      destinationOffset: gapSamples,
    })
    expect(destination[gapSamples - 1]).toBe(0)
    expect(destination[gapSamples]).toBeCloseTo(0.4)
  })

  it('places a clip that starts at timeline zero at sample zero', () => {
    expect(
      placedAudioTimelineMs({
        timelineStartMs: 0,
        sourceInMs: 0,
        sampleTimestampSec: 0,
      }),
    ).toBe(0)
    expect(timelineSampleOffset(0)).toBe(0)
  })

  it('meets consecutive clips without inserting or removing time', () => {
    const firstEnd = placedAudioTimelineMs({
      timelineStartMs: 0,
      sourceInMs: 0,
      sampleTimestampSec: 2,
    })
    const secondStart = placedAudioTimelineMs({
      timelineStartMs: 2_000,
      sourceInMs: 0,
      sampleTimestampSec: 0,
    })
    expect(firstEnd).toBe(2_000)
    expect(secondStart).toBe(firstEnd)
  })

  it('maps a trimmed source onto the timeline start', () => {
    expect(
      placedAudioTimelineMs({
        timelineStartMs: 5_000,
        sourceInMs: 2_000,
        sampleTimestampSec: 2,
      }),
    ).toBe(5_000)
    expect(
      placedAudioTimelineMs({
        timelineStartMs: 5_000,
        sourceInMs: 2_000,
        sampleTimestampSec: 2.5,
      }),
    ).toBe(5_500)
  })

  it('keeps silence between separated clips', () => {
    const later = placedAudioTimelineMs({
      timelineStartMs: 100,
      sourceInMs: 1_500,
      sampleTimestampSec: 1.5,
    })
    const destination = new Float32Array(timelineSampleOffset(later) + 1)
    mixIntoTimeline({
      destination,
      source: new Float32Array([0.2]),
      sourceRate: 48_000,
      destinationRate: 48_000,
      destinationOffset: timelineSampleOffset(0),
    })
    mixIntoTimeline({
      destination,
      source: new Float32Array([0.8]),
      sourceRate: 48_000,
      destinationRate: 48_000,
      destinationOffset: timelineSampleOffset(later),
    })
    expect(destination[0]).toBeCloseTo(0.2)
    expect(destination[1]).toBe(0)
    expect(destination.at(-1)).toBeCloseTo(0.8)
    expect(later).toBe(100)
  })
})

describe('pcm mix', () => {
  it('adds overlapping samples and clamps them', () => {
    const destination = new Float32Array(4)
    mixIntoTimeline({
      destination,
      source: new Float32Array([0.5, 0.5]),
      sourceRate: 48_000,
      destinationRate: 48_000,
      destinationOffset: 1,
    })
    mixIntoTimeline({
      destination,
      source: new Float32Array([0.75, 0.75]),
      sourceRate: 48_000,
      destinationRate: 48_000,
      destinationOffset: 1,
    })
    expect(Array.from(destination)).toEqual([0, 1.25, 1.25, 0])
    clampPcm(destination)
    expect(Array.from(destination)).toEqual([0, 1, 1, 0])
  })
})

describe('mp4 capability', () => {
  const size = { width: 1920, height: 1080 }
  const probe = (video: boolean, audio: boolean, webCodecs = true): Mp4EncodeProbe => ({
    webCodecs,
    canEncodeAvc: async () => video,
    canEncodeAac: async () => audio,
  })

  it('names the missing encoder instead of starting a silent export', async () => {
    expect(await mp4ExportBlocker(probe(false, true), size, true)).toMatch(/H\.264/)
    expect(await mp4ExportBlocker(probe(true, false), size, true)).toMatch(/AAC/)
    expect(await mp4ExportBlocker(probe(true, false), size, false)).toBeNull()
    expect(await mp4ExportBlocker(probe(true, true, false), size, false)).toMatch(/H\.264/)
  })

  it('reports a capability probe crash instead of calling the codec unsupported', async () => {
    const crashed: Mp4EncodeProbe = {
      webCodecs: true,
      canEncodeAvc: async () => {
        throw new TypeError('config.quality and config.bitrate cannot both be provided.')
      },
      canEncodeAac: async () => true,
    }
    await expect(mp4ExportBlocker(crashed, size, true)).rejects.toThrow(/couldn't check H\.264/)
  })

  it('does not set bitrate beside quality', () => {
    expect(videoExportEncoding()).not.toHaveProperty('bitrate')
    expect(audioExportEncoding()).not.toHaveProperty('bitrate')
    expect(videoExportEncoding().codec).toBe('avc')
    expect(audioExportEncoding().codec).toBe('aac')
  })
})

describe('export errors', () => {
  it('keeps the original message for the dialog', () => {
    const error = new TypeError('config.quality and config.bitrate cannot both be provided.')
    expect(reportExportError(error)).toMatchObject({
      name: 'TypeError',
      message: 'config.quality and config.bitrate cannot both be provided.',
    })
    expect(reportExportError(error).detail).toContain('TypeError')
  })
})
