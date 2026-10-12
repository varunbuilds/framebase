import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  VideoSampleSink,
} from 'mediabunny'
import { describe, expect, it } from 'vitest'
import type { Clip, MediaSource, ProjectDocument, Track } from '@/types/timeline'
import { renderProjectExport } from './export-renderer'
import { exportAudioSampleCount, exportFrameCount, exportFrameWindow } from './export-plan'
import { ExportCanceled } from './export-types'
import { encodeWavPcm, readWavPcm } from './export-wav'
import type { ExportSettings } from './export-settings'

const rate = 48_000

function track(partial: Pick<Track, 'id' | 'kind'>): Track {
  return {
    id: partial.id,
    name: partial.kind === 'video' ? 'Video 1' : 'Audio 1',
    kind: partial.kind,
    order: partial.kind === 'video' ? 0 : 1,
    muted: false,
    locked: false,
  }
}

function source(id: string): MediaSource {
  return {
    id,
    name: 'tone.wav',
    kind: 'audio',
    durationMs: 200,
    mimeType: 'audio/wav',
    locator: { kind: 'local', key: id },
    availability: 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
    hasVideo: false,
    hasAudio: true,
  }
}

function project(clip: Clip): ProjectDocument {
  return {
    id: 'project_export',
    name: 'Tone',
    canvas: { aspectRatio: '16:9' },
    tracks: [track({ id: 'v1', kind: 'video' }), track({ id: 'a1', kind: 'audio' })],
    clips: [clip],
    mediaSources: [source('m1')],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function wavFile(left: Float32Array, sampleRate: number): Blob {
  const encoded = encodeWavPcm({ left, right: left, sampleRate })
  const copy = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(copy).set(encoded)
  return new Blob([copy], { type: 'audio/wav' })
}

function constant(frames: number, value: number): Float32Array {
  return new Float32Array(frames).fill(value)
}

const settings = {
  mode: 'audio',
  quality: 'recommended',
  width: 1920,
  height: 1080,
  frameRate: 30,
  rangeStartMs: 0,
  rangeEndMs: 400,
} satisfies ExportSettings

function exportRuntimeAvailable(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined')
  )
}

describe('offline export mixer', () => {
  it('decodes a trim, keeps the leading gap, and writes the known level', async () => {
    const frames = Math.round(0.2 * rate)
    const left = constant(frames, 0.2)
    left.set(constant(frames - 2_400, 0.6), 2_400)
    const blob = wavFile(left, rate)
    const result = await renderProjectExport({
      snapshot: project({
        id: 'c1',
        mediaSourceId: 'm1',
        trackId: 'a1',
        timelineStartMs: 100,
        sourceInMs: 50,
        sourceOutMs: 200,
      }),
      settings,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      loadMedia: async () => blob,
    })
    const decoded = readWavPcm(new Uint8Array(await result.blob.arrayBuffer()))
    expect(decoded.sampleRate).toBe(rate)
    expect(decoded.channels).toBe(2)
    expect(decoded.frames).toBe(exportAudioSampleCount(400))
    expect(decoded.left[4_799]).toBe(0)
    expect(decoded.left[4_800]).toBeCloseTo(0.6, 2)
    expect(decoded.left[4_800 + 7_199]).toBeCloseTo(0.6, 2)
    expect(decoded.left[4_800 + 7_200]).toBe(0)
    expect(Math.max(...decoded.left)).toBeLessThan(0.7)
  })

  it('resamples a 44.1 kHz source without a hole in the clip', async () => {
    const sourceRate = 44_100
    const frames = Math.round(0.1 * sourceRate)
    const result = await renderProjectExport({
      snapshot: project({
        id: 'c1',
        mediaSourceId: 'm1',
        trackId: 'a1',
        timelineStartMs: 0,
        sourceInMs: 0,
        sourceOutMs: 100,
      }),
      settings: { ...settings, rangeEndMs: 100 },
      signal: new AbortController().signal,
      onProgress: () => undefined,
      loadMedia: async () => wavFile(constant(frames, 0.4), sourceRate),
    })
    const decoded = readWavPcm(new Uint8Array(await result.blob.arrayBuffer()))
    const interior = decoded.left.subarray(20, decoded.frames - 20)
    expect(Math.min(...interior)).toBeGreaterThan(0.3)
    expect(Math.max(...interior)).toBeLessThan(0.5)
    expect(decoded.frames).toBe(exportAudioSampleCount(100))
  })

  it('rejects a canceled export and can export again afterwards', async () => {
    const controller = new AbortController()
    controller.abort()
    const snapshot = project({
      id: 'c1',
      mediaSourceId: 'm1',
      trackId: 'a1',
      timelineStartMs: 0,
      sourceInMs: 0,
      sourceOutMs: 100,
    })
    const blob = wavFile(constant(4_800, 0.2), rate)
    await expect(
      renderProjectExport({
        snapshot,
        settings: { ...settings, rangeEndMs: 100 },
        signal: controller.signal,
        onProgress: () => undefined,
        loadMedia: async () => blob,
      }),
    ).rejects.toBeInstanceOf(ExportCanceled)

    const result = await renderProjectExport({
      snapshot,
      settings: { ...settings, rangeEndMs: 100 },
      signal: new AbortController().signal,
      onProgress: () => undefined,
      loadMedia: async () => blob,
    })
    const decoded = readWavPcm(new Uint8Array(await result.blob.arrayBuffer()))
    expect(decoded.left[100]).toBeCloseTo(0.2, 2)
  })
})

describe('mp4 export file', () => {
  it.skipIf(!exportRuntimeAvailable())(
    'reopens an exported mp4 with both streams and aligned durations',
    async () => {
      const durationMs = 500
      const blob = wavFile(constant(Math.round(0.5 * rate), 0.25), rate)
      const result = await renderProjectExport({
        snapshot: project({
          id: 'c1',
          mediaSourceId: 'm1',
          trackId: 'a1',
          timelineStartMs: 0,
          sourceInMs: 0,
          sourceOutMs: durationMs,
        }),
        settings: {
          mode: 'video',
          quality: 'small',
          width: 480,
          height: 270,
          frameRate: 30,
          rangeStartMs: 0,
          rangeEndMs: durationMs,
        },
        signal: new AbortController().signal,
        onProgress: () => undefined,
        loadMedia: async () => blob,
      })
      const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(result.blob),
      })
      try {
        const video = await input.getPrimaryVideoTrack()
        const audio = await input.getPrimaryAudioTrack()
        expect(video).toBeTruthy()
        expect(audio).toBeTruthy()
        if (!video || !audio) return
        const videoDuration = await video.computeDuration()
        const audioDuration = await audio.computeDuration()
        const frames = exportFrameCount(durationMs, 30)
        const last = exportFrameWindow(frames - 1, frames, durationMs, 30)
        const videoEnd = last.timestampSec + last.durationSec
        expect(videoDuration).toBeCloseTo(videoEnd, 2)
        expect(Math.abs(audioDuration - videoDuration)).toBeLessThan(0.05)
        const videoSink = new VideoSampleSink(video)
        const audioSink = new AudioSampleSink(audio)
        const firstVideo = await videoSink.getSample(0)
        const firstAudio = await audioSink.getSample(0)
        expect(firstVideo?.timestamp).toBeGreaterThanOrEqual(0)
        expect(firstAudio?.timestamp).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(firstVideo?.timestamp)).toBe(true)
        expect(Number.isFinite(firstAudio?.timestamp)).toBe(true)
        firstVideo?.close()
        firstAudio?.close()
      } finally {
        input.dispose()
      }
    },
  )
})
