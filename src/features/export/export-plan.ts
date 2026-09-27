import { getPlaybackEndMs, resolveActiveVideoClip } from '@/features/editor/playback'
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

export function exportFrameCount(durationMs: number): number {
  if (durationMs <= 0) return 0
  return Math.ceil((durationMs / 1000) * EXPORT_FPS - 1e-9)
}

export function exportFrameWindow(
  index: number,
  frameCount: number,
  durationMs: number,
): { timelineMs: number; timestampSec: number; durationSec: number } {
  const durationSec = durationMs / 1000
  const timestampSec = index / EXPORT_FPS
  const nextSec =
    index === frameCount - 1 ? durationSec : Math.min(durationSec, (index + 1) / EXPORT_FPS)
  return {
    timelineMs: Math.round(timestampSec * 1000),
    timestampSec,
    durationSec: Math.max(nextSec - timestampSec, 1 / (EXPORT_FPS * 10)),
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
 * Audio the export will mux.
 * Clips on unmuted audio tracks are mixed at their timeline positions.
 * A video file's audio is included only when no audio-track clip owns that
 * source, so a muted or moved audio clip is not replaced by the video file.
 */
export function audioSpansForExport(document: ProjectDocument): ExportAudioSpan[] {
  const endMs = exportDurationMs(document)
  const spans: ExportAudioSpan[] = []
  const represented = new Set<string>()

  for (const clip of document.clips) {
    const track = getTrackById(document, clip.trackId)
    if (!track || track.kind !== 'audio') continue
    const source = getMediaSourceById(document, clip.mediaSourceId)
    if (!source?.hasAudio) continue
    represented.add(source.id)
    if (track.muted) continue
    const span = spanForClip(clip, source, endMs)
    if (span) spans.push(span)
  }

  for (const clip of document.clips) {
    const track = getTrackById(document, clip.trackId)
    if (!track || track.kind !== 'video') continue
    const source = getMediaSourceById(document, clip.mediaSourceId)
    if (!source?.hasAudio || represented.has(source.id)) continue
    const span = spanForClip(clip, source, endMs)
    if (span) spans.push(span)
  }

  return spans
}

export function requiredMediaSources(document: ProjectDocument): MediaSource[] {
  const ids = new Set<string>()
  for (const clip of document.clips) {
    const track = getTrackById(document, clip.trackId)
    if (track?.kind === 'video') ids.add(clip.mediaSourceId)
  }
  for (const span of audioSpansForExport(document)) ids.add(span.mediaSourceId)

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

export function exportFilename(projectName: string): string {
  const cleaned = [...projectName]
    .map((character) => (isUnsafeFilenameCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return `${cleaned || 'Untitled'}.mp4`
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

/** Sample index in the mix for a timeline instant. */
export function timelineSampleOffset(timelineMs: number, sampleRate = EXPORT_SAMPLE_RATE): number {
  return Math.round((timelineMs / 1000) * sampleRate)
}

/** Add source samples into a mix, resampling when the rates differ. */
export function mixIntoTimeline(args: {
  destination: Float32Array
  source: Float32Array
  sourceRate: number
  destinationRate: number
  destinationOffset: number
}): void {
  const { destination, source, sourceRate, destinationRate, destinationOffset } = args
  if (source.length === 0 || sourceRate <= 0 || destinationRate <= 0) return

  if (sourceRate === destinationRate) {
    const start = Math.max(0, destinationOffset)
    const end = Math.min(destination.length, destinationOffset + source.length)
    for (let index = start; index < end; index += 1) {
      destination[index] = (destination[index] ?? 0) + (source[index - destinationOffset] ?? 0)
    }
    return
  }

  const destFrames = Math.max(1, Math.round((source.length * destinationRate) / sourceRate))
  for (let index = 0; index < destFrames; index += 1) {
    const destIndex = destinationOffset + index
    if (destIndex < 0 || destIndex >= destination.length) continue
    const position = (index * sourceRate) / destinationRate
    const left = Math.floor(position)
    const right = Math.min(source.length - 1, left + 1)
    const weight = position - left
    const sample =
      (source[left] ?? 0) * (1 - weight) + (source[right] ?? 0) * weight
    destination[destIndex] = (destination[destIndex] ?? 0) + sample
  }
}

export function clampPcm(samples: Float32Array): void {
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0
    samples[index] = value < -1 ? -1 : value > 1 ? 1 : value
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
  endMs: number,
): ExportAudioSpan | null {
  const durationMs = Math.max(0, clip.sourceOutMs - clip.sourceInMs)
  const visibleMs = Math.min(durationMs, Math.max(0, endMs - clip.timelineStartMs))
  if (visibleMs <= 0 || clip.timelineStartMs >= endMs) return null
  return {
    mediaSourceId: source.id,
    mediaName: source.name,
    timelineStartMs: clip.timelineStartMs,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceInMs + visibleMs,
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
