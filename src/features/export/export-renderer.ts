import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
} from 'mediabunny'
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
  requiredMediaSources,
  timelineSampleOffset,
  unavailableMediaMessage,
} from './export-plan'
import {
  audioExportEncoding,
  browserMp4Probe,
  mp4ExportBlocker,
  videoExportEncoding,
} from './export-capabilities'
import { logExport, logExportError, reportExportError } from './export-log'
import { loadExportMedia } from './export-media'
import {
  EXPORT_BACKGROUND,
  EXPORT_CHANNELS,
  EXPORT_CONTAINER,
  EXPORT_SAMPLE_RATE,
  ExportCanceled,
  ExportFailure,
  isExportCanceled,
  type ExportAudioSpan,
  type ExportRequest,
} from './export-types'

type OpenedMedia = {
  input: Input
  video: VideoSampleSink | null
  audio: AudioSampleSink | null
}

type FrameJob =
  | { kind: 'gap'; timestampSec: number; durationSec: number }
  | {
      kind: 'frame'
      mediaSourceId: string
      mediaName: string
      sourceSec: number
      timestampSec: number
      durationSec: number
    }

/**
 * Encodes one immutable project snapshot to an MP4 blob.
 * Does not read Liveblocks, the editor store, or the live document.
 */
export async function renderProjectExport(
  request: ExportRequest & {
    loadMedia?: (mediaSourceId: string) => Promise<Blob | null>
  },
): Promise<{ blob: Blob; filename: string }> {
  const { snapshot, signal, onProgress } = request
  const loadMedia = request.loadMedia ?? loadExportMedia
  logExport('Starting export', {
    projectId: snapshot.id,
    aspectRatio: snapshot.canvas.aspectRatio,
  })
  throwIfCanceled(signal)

  const durationMs = exportDurationMs(snapshot)
  const spans = audioSpansForExport(snapshot)
  const frameCount = exportFrameCount(durationMs)
  logExport('Snapshot created', {
    durationMs,
    clips: snapshot.clips.length,
    audioSpans: spans.length,
    frameCount,
  })
  logExport('Export plan created', {
    video: frameCount > 0,
    audio: spans.length > 0,
  })
  if (durationMs <= 0 || frameCount === 0) {
    throw new ExportFailure(emptyTimelineMessage())
  }

  const size = exportSizeFor(snapshot.canvas.aspectRatio)
  onProgress({ phase: 'preparing', fraction: null })

  const blocker = await mp4ExportBlocker(browserMp4Probe(), size, spans.length > 0)
  throwIfCanceled(signal)
  if (blocker) throw new ExportFailure(blocker)

  logExport('Media preparation started', {
    sources: requiredMediaSources(snapshot).map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      hasVideo: source.hasVideo,
      hasAudio: source.hasAudio,
    })),
  })
  const required = requiredMediaSources(snapshot)
  const blobs = new Map<string, Blob>()
  const missing: { name: string }[] = []
  for (const source of required) {
    throwIfCanceled(signal)
    const blob = await loadMedia(source.id)
    if (!blob) missing.push({ name: source.name })
    else {
      blobs.set(source.id, blob)
      logExport('Media preparation started', {
        id: source.id,
        name: source.name,
        bytes: blob.size,
        type: blob.type,
      })
    }
  }
  if (missing.length > 0) throw new ExportFailure(unavailableMediaMessage(missing))

  const opened: OpenedMedia[] = []
  const byId = new Map<string, OpenedMedia>()
  let output: Output | null = null
  let pendingAudio: AudioSample[] = []

  const canvas = createCanvas(size.width, size.height)
  const context = drawingContext(canvas)
  if (!context) {
    throw new ExportFailure('Export failed because this browser could not create a drawing surface.')
  }
  context.imageSmoothingEnabled = true
  logExport('Renderer started', {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    aspectRatio: snapshot.canvas.aspectRatio,
  })

  try {
    const open = async (mediaSourceId: string, mediaName: string) => {
      const existing = byId.get(mediaSourceId)
      if (existing) return existing
      const blob = blobs.get(mediaSourceId)
      if (!blob) throw new ExportFailure(unavailableMediaMessage([{ name: mediaName }]))
      let input: Input | null = null
      try {
        input = new Input({
          formats: ALL_FORMATS,
          source: new BlobSource(blob),
        })
        const videoTrack = await input.getPrimaryVideoTrack()
        const audioTrack = await input.getPrimaryAudioTrack()
        const media: OpenedMedia = {
          input,
          video: videoTrack ? new VideoSampleSink(videoTrack) : null,
          audio: audioTrack ? new AudioSampleSink(audioTrack) : null,
        }
        opened.push(media)
        byId.set(mediaSourceId, media)
        input = null
        return media
      } catch (error) {
        input?.dispose()
        throwDecodeFailure(error, mediaName)
      }
    }

    const target = new BufferTarget()
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    })
    const videoSource = new CanvasSource(canvas, videoExportEncoding())
    output.addVideoTrack(videoSource)
    logExport('Video encoder initialized', {
      codec: 'avc',
      width: canvas.width,
      height: canvas.height,
    })

    if (spans.length > 0) {
      const mixed = await mixSpans({ spans, open, signal, durationMs })
      const audioContext = new AudioContext({ sampleRate: EXPORT_SAMPLE_RATE })
      try {
        const buffer = audioContext.createBuffer(
          EXPORT_CHANNELS,
          mixed.left.length,
          EXPORT_SAMPLE_RATE,
        )
        buffer.copyToChannel(Float32Array.from(mixed.left), 0)
        buffer.copyToChannel(Float32Array.from(mixed.right), 1)
        pendingAudio = AudioSample.fromAudioBuffer(buffer, 0)
      } finally {
        await audioContext.close()
      }
      const audioSource = new AudioSampleSource(audioExportEncoding())
      output.addAudioTrack(audioSource)
      logExport('Audio encoder initialized', { codec: 'aac', spans: spans.length })
      await output.start()
      for (const sample of pendingAudio) {
        throwIfCanceled(signal)
        await audioSource.add(sample)
        sample.close()
      }
      pendingAudio = []
    } else {
      logExport('Audio encoder initialized', { codec: null, spans: 0 })
      await output.start()
    }

    const jobs = frameJobs(snapshot, durationMs)
    onProgress({ phase: 'rendering', fraction: 0 })
    logExport('Rendering started', { frames: jobs.length })
    let completed = 0
    let lastLoggedFrame = -30

    for (let index = 0; index < jobs.length; ) {
      throwIfCanceled(signal)
      const job = jobs[index]
      if (!job) break
      if (job.kind === 'gap') {
        paintBackground(context, size.width, size.height)
        await videoSource.add(job.timestampSec, job.durationSec)
        index += 1
        completed += 1
        onProgress({ phase: 'rendering', fraction: completed / jobs.length })
        continue
      }

      const run: Extract<FrameJob, { kind: 'frame' }>[] = []
      while (index < jobs.length) {
        const next = jobs[index]
        if (!next || next.kind !== 'frame' || next.mediaSourceId !== job.mediaSourceId) break
        run.push(next)
        index += 1
      }

      logExport('Rendering frame/segment', {
        media: job.mediaName,
        frames: run.length,
        atFrame: completed,
      })
      const media = await open(job.mediaSourceId, job.mediaName)
      if (!media.video) throw new ExportFailure(decodeMessage(job.mediaName))
      let drawn = 0
      const frames = media.video.samplesAtTimestamps(run.map((item) => item.sourceSec))
      try {
        for (const item of run) {
          throwIfCanceled(signal)
          let sample: Awaited<ReturnType<typeof frames.next>>['value'] | null = null
          try {
            const step = await frames.next()
            sample = step.value ?? null
          } catch (error) {
            throwDecodeFailure(error, job.mediaName)
          }
          paintBackground(context, size.width, size.height)
          if (sample) {
            sample.drawWithFit(context, { fit: 'contain' })
            sample.close()
            drawn += 1
          }
          await videoSource.add(item.timestampSec, item.durationSec)
          completed += 1
          if (completed - lastLoggedFrame >= 30) {
            lastLoggedFrame = completed
            logExport('Rendering frame/segment', {
              completed,
              total: jobs.length,
            })
          }
          onProgress({ phase: 'rendering', fraction: completed / jobs.length })
        }
      } finally {
        await frames.return(undefined)
      }
      if (drawn === 0) throw new ExportFailure(decodeMessage(job.mediaName))
    }

    throwIfCanceled(signal)
    onProgress({ phase: 'finalizing', fraction: 1 })
    logExport('Finalizing MP4')
    await output.finalize()
    const mime = await output.getMimeType()
    if (!mime.startsWith(EXPORT_CONTAINER)) {
      throw new ExportFailure('Export failed because this browser did not produce an MP4 file.')
    }
    const buffer = target.buffer
    if (!buffer) throw new ExportFailure('Export failed before a video file was written.')
    logExport('Export completed', {
      bytes: buffer.byteLength,
      mime,
      filename: exportFilename(snapshot.name),
    })
    output = null
    return {
      blob: new Blob([buffer], { type: EXPORT_CONTAINER }),
      filename: exportFilename(snapshot.name),
    }
  } catch (error) {
    logExportError(error)
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => undefined)
    }
    throw toUserError(error, signal)
  } finally {
    for (const sample of pendingAudio) sample.close()
    for (const media of opened) media.input.dispose()
  }
}

async function mixSpans(args: {
  spans: ExportAudioSpan[]
  open: (mediaSourceId: string, mediaName: string) => Promise<OpenedMedia>
  signal: AbortSignal
  durationMs: number
}): Promise<{ left: Float32Array; right: Float32Array }> {
  const length = Math.max(1, timelineSampleOffset(args.durationMs))
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  let wrote = 0

  for (const span of args.spans) {
    throwIfCanceled(args.signal)
    const media = await args.open(span.mediaSourceId, span.mediaName)
    if (!media.audio) throw new ExportFailure(decodeMessage(span.mediaName))
    const sourceInSec = span.sourceInMs / 1000
    const sourceOutSec = span.sourceOutMs / 1000
    try {
      for await (const sample of media.audio.samples(sourceInSec, sourceOutSec)) {
        throwIfCanceled(args.signal)
        const used = trimToRange(sample, sourceInSec, sourceOutSec)
        if (!used) {
          sample.close()
          continue
        }
        const planes = readPlanar(used)
        const timelineMs = placedAudioTimelineMs({
          timelineStartMs: span.timelineStartMs,
          sourceInMs: span.sourceInMs,
          sampleTimestampSec: used.timestamp,
        })
        const offset = timelineSampleOffset(timelineMs)
        const primary = planes[0]
        if (primary) {
          mixIntoTimeline({
            destination: left,
            source: primary,
            sourceRate: used.sampleRate,
            destinationRate: EXPORT_SAMPLE_RATE,
            destinationOffset: offset,
          })
          mixIntoTimeline({
            destination: right,
            source: planes[1] ?? primary,
            sourceRate: used.sampleRate,
            destinationRate: EXPORT_SAMPLE_RATE,
            destinationOffset: offset,
          })
          wrote += used.numberOfFrames
        }
        if (used !== sample) sample.close()
        used.close()
      }
    } catch (error) {
      throwDecodeFailure(error, span.mediaName)
    }
  }

  if (wrote === 0) {
    throw new ExportFailure(decodeMessage(args.spans[0]?.mediaName ?? 'Audio'))
  }
  clampPcm(left)
  clampPcm(right)
  return { left, right }
}

function trimToRange(
  sample: AudioSample,
  startSec: number,
  endSec: number,
): AudioSample | null {
  const sampleEnd = sample.timestamp + sample.duration
  const keepStart = Math.max(sample.timestamp, startSec)
  const keepEnd = Math.min(sampleEnd, endSec)
  if (keepEnd <= keepStart) return null
  const startFrame = Math.max(
    0,
    Math.round((keepStart - sample.timestamp) * sample.sampleRate),
  )
  const endFrame = Math.min(
    sample.numberOfFrames,
    Math.round((keepEnd - sample.timestamp) * sample.sampleRate),
  )
  if (endFrame <= startFrame) return null
  if (startFrame === 0 && endFrame === sample.numberOfFrames) return sample
  return sample.trim(startFrame, endFrame)
}

function readPlanar(sample: AudioSample): Float32Array[] {
  const channels = Math.min(sample.numberOfChannels, EXPORT_CHANNELS)
  const planes: Float32Array[] = []
  for (let channel = 0; channel < channels; channel += 1) {
    const data = new Float32Array(sample.numberOfFrames)
    sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' })
    planes.push(data)
  }
  return planes
}

function frameJobs(
  snapshot: ExportRequest['snapshot'],
  durationMs: number,
): FrameJob[] {
  const count = exportFrameCount(durationMs)
  const jobs: FrameJob[] = []
  for (let index = 0; index < count; index += 1) {
    const window = exportFrameWindow(index, count, durationMs)
    const picture = pictureAt(snapshot, window.timelineMs)
    if (picture.kind === 'gap') {
      jobs.push({
        kind: 'gap',
        timestampSec: window.timestampSec,
        durationSec: window.durationSec,
      })
      continue
    }
    jobs.push({
      kind: 'frame',
      mediaSourceId: picture.mediaSourceId,
      mediaName: picture.mediaName,
      sourceSec: picture.sourceTimeMs / 1000,
      timestampSec: window.timestampSec,
      durationSec: window.durationSec,
    })
  }
  return jobs
}

function paintBackground(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.fillStyle = EXPORT_BACKGROUND
  context.fillRect(0, 0, width, height)
}

function drawingContext(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  const context = canvas.getContext('2d')
  if (!context || !('fillRect' in context)) return null
  return context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function throwIfCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw new ExportCanceled()
}

function decodeMessage(name: string): string {
  return `Export failed because '${name}' could not be decoded.`
}

function throwDecodeFailure(error: unknown, name: string): never {
  if (isExportCanceled(error) || error instanceof ExportFailure) throw error
  const report = reportExportError(error)
  throw new ExportFailure(decodeMessage(name), { cause: error, detail: report.detail })
}

function toUserError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted || isExportCanceled(error)) return new ExportCanceled()
  if (error instanceof ExportFailure) return error
  const report = reportExportError(error)
  if (/out of memory|allocation failed|not enough memory/i.test(report.detail) || report.name === 'QuotaExceededError') {
    return new ExportFailure('Export failed because the browser ran out of memory.', {
      cause: error,
      detail: report.detail,
    })
  }
  return new ExportFailure(report.message || 'Export failed.', {
    cause: error,
    detail: report.detail,
  })
}
