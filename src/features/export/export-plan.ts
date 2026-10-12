import {
  collectTimelineAudio,
  getPlaybackEndMs,
  resolveActiveVideoClip,
} from '@/features/editor/playback'
import { getMediaSourceById, getTrackById } from '@/features/editor/project'
import type {
  CanvasAspectRatio,
  Clip,
  MediaSource,
  ProjectDocument,
} from '@/types/timeline'
import {
  EXPORT_FPS,
  EXPORT_SAMPLE_RATE,
  EXPORT_SIZES,
  type ExportAudioSpan,
  type ExportEvent,
  type ExportJob,
  type ExportPicture,
  type ExportSize,
} from './export-types'

const ACTIVE_JOB = new Set<ExportJob['status']>([
  'preparing',
  'rendering',
  'finalizing',
])

/**
 * Copy taken when Export is clicked. Rendering reads only this value.
 * A later collaborative edit changes the live document, not this snapshot.
 */
export function snapshotProject(document: ProjectDocument): ProjectDocument {
  return deepFreeze(structuredClone(document))
}

export function exportSizeFor(aspectRatio: CanvasAspectRatio): ExportSize {
  const size = EXPORT_SIZES[aspectRatio]
  return {
    width: size.width,
    height: size.height,
    label: `${size.width} × ${size.height}`,
  }
}

/** Same end the preview clock uses. Not a second definition of duration. */
export function exportDurationMs(document: ProjectDocument): number {
  return getPlaybackEndMs(document)
}

export function exportFrameCount(durationMs: number, frameRate = EXPORT_FPS): number {
  if (durationMs <= 0 || frameRate <= 0) return 0
  return Math.ceil((durationMs / 1000) * frameRate - 1e-9)
}

export function exportFrameWindow(
  index: number,
  frameCount: number,
  durationMs: number,
  frameRate = EXPORT_FPS,
): { timelineMs: number; timestampSec: number; durationSec: number } {
  const durationSec = durationMs / 1000
  const timestampSec = index / frameRate
  const nextSec =
    index === frameCount - 1 ? durationSec : Math.min(durationSec, (index + 1) / frameRate)
  return {
    timelineMs: Math.round(timestampSec * 1000),
    timestampSec,
    // The last frame ends on the requested duration. A minimum duration would
    // push that frame past the audio mix whenever the remainder is very short.
    durationSec: Math.max(0, nextSec - timestampSec),
  }
}

/** Foreground picture at one frame, using the preview's clip resolver. */
export function pictureAt(
  document: ProjectDocument,
  timelineMs: number,
): ExportPicture {
  const active = resolveActiveVideoClip(document, timelineMs)
  if (!active) return { kind: 'gap' }
  const media = getMediaSourceById(document, active.clip.mediaSourceId)
  return {
    kind: 'frame',
    clipId: active.clip.id,
    mediaSourceId: active.clip.mediaSourceId,
    mediaName: media?.name ?? 'Untitled',
    sourceTimeMs: active.sourceTimeMs,
  }
}

/**
 * Audio the export will mux. Same clip selection as preview playback:
 * unmuted audio-track clips, plus a video file's audio only when no
 * audio-track clip owns that source.
 */
export function audioSpansForExport(
  document: ProjectDocument,
  range?: { startMs: number; endMs: number },
): ExportAudioSpan[] {
  const projectEnd = exportDurationMs(document)
  const startMs = range?.startMs ?? 0
  const endMs = range?.endMs ?? projectEnd
  const { audibleAudioClips, embeddedVideoClips } = collectTimelineAudio(document)
  const spans: ExportAudioSpan[] = []
  for (const { clip, source } of [...audibleAudioClips, ...embeddedVideoClips]) {
    const span = spanForClip(clip, source, startMs, endMs)
    if (span) spans.push(span)
  }
  return spans
}

export function requiredMediaSources(
  document: ProjectDocument,
  range?: { startMs: number; endMs: number },
): MediaSource[] {
  const ids = new Set<string>()
  const startMs = range?.startMs ?? 0
  const endMs = range?.endMs ?? exportDurationMs(document)
  for (const clip of document.clips) {
    const track = getTrackById(document, clip.trackId)
    if (track?.kind !== 'video' || track.muted) continue
    const clipEnd = clip.timelineStartMs + Math.max(0, clip.sourceOutMs - clip.sourceInMs)
    if (clipEnd <= startMs || clip.timelineStartMs >= endMs) continue
    ids.add(clip.mediaSourceId)
  }
  for (const span of audioSpansForExport(document, range)) ids.add(span.mediaSourceId)

  const sources: MediaSource[] = []
  for (const id of ids) {
    const source = getMediaSourceById(document, id)
    if (source) sources.push(source)
  }
  return sources
}

export function unavailableMedia(
  document: ProjectDocument,
  isAvailable: (mediaSourceId: string) => boolean,
): MediaSource[] {
  return requiredMediaSources(document).filter((source) => !isAvailable(source.id))
}

export function unavailableMediaMessage(sources: readonly { name: string }[]): string {
  const count = sources.length
  const verb = count === 1 ? 'is' : 'are'
  const noun = count === 1 ? 'media file' : 'media files'
  const names = sources.map((source) => source.name.trim()).filter(Boolean)
  const listed = names.length > 0 ? `: ${names.join(', ')}` : ''
  return `Export can't start because ${count} ${noun} ${verb} unavailable${listed}.`
}

export function emptyTimelineMessage(): string {
  return "Export can't start because the timeline is empty."
}

export function exportFilename(projectName: string, extension = 'mp4'): string {
  const cleaned = [...projectName]
    .map((character) => (isUnsafeFilenameCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return `${cleaned || 'Untitled'}.${extension.replace(/^\./, '')}`
}

function isUnsafeFilenameCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return (
    code < 32 ||
    character === '\\' ||
    character === '/' ||
    character === ':' ||
    character === '*' ||
    character === '?' ||
    character === '"' ||
    character === '<' ||
    character === '>' ||
    character === '|'
  )
}

export function exportPercent(fraction: number | null): number | null {
  if (fraction == null || !Number.isFinite(fraction)) return null
  return Math.min(100, Math.max(0, Math.round(fraction * 100)))
}

export function exportPhaseLabel(
  phase: 'preparing' | 'rendering' | 'finalizing',
  fraction: number | null,
): string {
  if (phase === 'preparing') return 'Preparing…'
  if (phase === 'finalizing') return 'Finalizing…'
  const percent = exportPercent(fraction)
  return percent == null ? 'Rendering…' : `Rendering… ${percent}%`
}

/**
 * Timeline time of one decoded audio sample.
 * Timestamp is seconds in the source file; subtracting sourceIn keeps a
 * trimmed clip on its timeline start, including after a leading gap.
 */
export function placedAudioTimelineMs(args: {
  timelineStartMs: number
  sourceInMs: number
  sampleTimestampSec: number
}): number {
  const sourceInSec = args.sourceInMs / 1000
  return args.timelineStartMs + Math.round((args.sampleTimestampSec - sourceInSec) * 1000)
}

/** Sample index in the mix for a timeline instant. */
export function timelineSampleOffset(timelineMs: number, sampleRate = EXPORT_SAMPLE_RATE): number {
  return Math.round((timelineMs / 1000) * sampleRate)
}

/**
 * Where a decoded packet belongs in the mix.
 * Packet timestamps are fractional seconds. Rounding each packet to a whole
 * millisecond shifts a 1024-frame block by tens of samples, so the next
 * packet overlaps the previous one and the sum bursts.
 */
/** Unrounded timeline time of one decoded packet, in seconds. */
export function audioMixTimelineSec(args: {
  timelineStartMs: number
  sourceInMs: number
  sampleTimestampSec: number
}): number {
  return args.timelineStartMs / 1000 + (args.sampleTimestampSec - args.sourceInMs / 1000)
}

export function audioMixSampleOffset(args: {
  timelineStartMs: number
  sourceInMs: number
  sampleTimestampSec: number
  sampleRate: number
}): number {
  return Math.round(audioMixTimelineSec(args) * args.sampleRate)
}

export function exportAudioSampleCount(
  durationMs: number,
  sampleRate = EXPORT_SAMPLE_RATE,
): number {
  if (durationMs <= 0 || sampleRate <= 0) return 0
  return Math.round((durationMs / 1000) * sampleRate)
}

/**
 * Add one decoded packet into the mix.
 * `timelineStartSec` is the packet's real timeline time, before rounding.
 * Each packet occupies [round(start), round(start + duration)), so the next
 * packet begins where this one ended even when the source rate is not 48 kHz.
 */
export function mixIntoTimeline(args: {
  destination: Float32Array
  source: Float32Array
  sourceRate: number
  destinationRate: number
  destinationOffset?: number
  timelineStartSec?: number
}): void {
  const { destination, source, sourceRate, destinationRate } = args
  if (source.length === 0 || sourceRate <= 0 || destinationRate <= 0) return
  const timelineStartSec =
    args.timelineStartSec ?? (args.destinationOffset ?? 0) / destinationRate
  const start = Math.round(timelineStartSec * destinationRate)
  const end = Math.round((timelineStartSec + source.length / sourceRate) * destinationRate)
  const first = Math.max(0, start)
  const last = Math.min(destination.length, end)

  for (let destIndex = first; destIndex < last; destIndex += 1) {
    const raw = (destIndex / destinationRate - timelineStartSec) * sourceRate
    // Rounding the packet onto the destination grid can place one sample
    // just outside the source. Read the nearest source sample instead of
    // leaving that destination sample silent.
    const position = Math.min(source.length - 1, Math.max(0, raw))
    const left = Math.floor(position)
    const right = Math.min(source.length - 1, left + 1)
    const weight = position - left
    const sample = (source[left] ?? 0) * (1 - weight) + (source[right] ?? 0) * weight
    destination[destIndex] = (destination[destIndex] ?? 0) + sample
  }
}

/**
 * Brings samples outside full scale back to ±1. Samples already inside
 * [-1, 1] are left alone, including ones near full scale.
 */
export function clampPcm(samples: Float32Array): void {
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0
    if (value > 1) samples[index] = 1
    else if (value < -1) samples[index] = -1
  }
}

export function reduceExportJob(state: ExportJob, event: ExportEvent): ExportJob {
  if (event.type === 'reset') return { status: 'idle' }

  if (event.type === 'cancel') {
    if (!ACTIVE_JOB.has(state.status)) return state
    return { status: 'canceled' }
  }

  if (event.type === 'start') {
    if (ACTIVE_JOB.has(state.status)) return state
    return { status: 'preparing' }
  }

  if (event.type === 'fail') {
    if (!ACTIVE_JOB.has(state.status)) return state
    return { status: 'failed', message: event.message, detail: event.detail }
  }

  if (state.status === 'canceled') return state

  if (event.type === 'complete') {
    if (state.status !== 'finalizing' && state.status !== 'rendering') return state
    return { status: 'complete', filename: event.filename }
  }

  if (!ACTIVE_JOB.has(state.status)) return state

  const percent = exportPercent(event.progress.fraction)
  if (event.progress.phase === 'preparing') return { status: 'preparing' }
  if (event.progress.phase === 'finalizing') {
    return { status: 'finalizing', percent: percent ?? percentOf(state) }
  }
  return { status: 'rendering', percent: percent ?? 0 }
}

function percentOf(state: ExportJob): number {
  if (state.status === 'rendering' || state.status === 'finalizing') return state.percent
  return 0
}

function spanForClip(
  clip: Clip,
  source: MediaSource,
  rangeStartMs: number,
  rangeEndMs: number,
): ExportAudioSpan | null {
  const clipEndMs = clip.timelineStartMs + Math.max(0, clip.sourceOutMs - clip.sourceInMs)
  const startMs = Math.max(clip.timelineStartMs, rangeStartMs)
  const endMs = Math.min(clipEndMs, rangeEndMs)
  if (endMs <= startMs) return null
  const intoClipMs = startMs - clip.timelineStartMs
  return {
    mediaSourceId: source.id,
    mediaName: source.name,
    timelineStartMs: startMs - rangeStartMs,
    sourceInMs: clip.sourceInMs + intoClipMs,
    sourceOutMs: clip.sourceInMs + intoClipMs + (endMs - startMs),
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return value
}
