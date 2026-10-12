import type { CanvasAspectRatio, ProjectDocument } from '@/types/timeline'
import type { Mp4EncodeProbe } from './export-capabilities'
import { requiredMediaSources } from './export-plan'
import { EXPORT_SAMPLE_RATE, EXPORT_SIZES } from './export-types'

export const QUALITY_PRESETS = {
  small: { label: 'Small file', videoBitrate: 2_000_000, audioBitrate: 96_000 },
  balanced: { label: 'Balanced', videoBitrate: 5_000_000, audioBitrate: 128_000 },
  recommended: { label: 'Recommended', videoBitrate: 8_000_000, audioBitrate: 192_000 },
  maximum: { label: 'Maximum', videoBitrate: 16_000_000, audioBitrate: 256_000 },
} as const

export type ExportQuality = keyof typeof QUALITY_PRESETS

export const EXPORT_FRAME_RATES = [24, 25, 30, 60] as const

export type ExportFrameRate = (typeof EXPORT_FRAME_RATES)[number]

export type ExportSettings = {
  mode: 'video' | 'audio'
  quality: ExportQuality
  width: number
  height: number
  frameRate: ExportFrameRate
  rangeStartMs: number
  rangeEndMs: number
}

/** Containers and codecs this renderer does not write. Shown disabled, never selected. */
export const UNSUPPORTED_EXPORT_OPTIONS = [
  { id: 'webm', label: 'WebM', reason: 'This exporter writes MP4 video and WAV audio.' },
  { id: 'mov', label: 'MOV', reason: 'This exporter writes MP4 video and WAV audio.' },
  { id: 'mkv', label: 'MKV', reason: 'This exporter writes MP4 video and WAV audio.' },
  { id: 'hevc', label: 'H.265', reason: 'Video is encoded as H.264.' },
  { id: 'vp8', label: 'VP8', reason: 'Video is encoded as H.264.' },
  { id: 'vp9', label: 'VP9', reason: 'Video is encoded as H.264.' },
  { id: 'av1', label: 'AV1', reason: 'Video is encoded as H.264.' },
  { id: 'mp3', label: 'MP3', reason: 'No MP3 encoder is wired into this exporter.' },
  { id: 'm4a', label: 'AAC/M4A', reason: 'Audio-only export writes 16-bit WAV.' },
  { id: 'subtitles', label: 'Subtitles', reason: 'This project has no caption track to burn in or export.' },
  {
    id: 'smart-copy',
    label: 'Smart copy',
    reason: 'Trims and mixed tracks are rendered. Compatible streams are not remuxed.',
  },
] as const

export function defaultExportSettings(
  aspectRatio: CanvasAspectRatio,
  durationMs: number,
): ExportSettings {
  const size = EXPORT_SIZES[aspectRatio]
  return {
    mode: 'video',
    quality: 'recommended',
    width: size.width,
    height: size.height,
    frameRate: 30,
    rangeStartMs: 0,
    rangeEndMs: Math.max(0, durationMs),
  }
}

export function resolutionChoices(
  aspectRatio: CanvasAspectRatio,
): Array<{ width: number; height: number; label: string }> {
  const full = EXPORT_SIZES[aspectRatio]
  const choices = [{ ...full, label: `${full.width} × ${full.height}` }]
  let width = full.width
  let height = full.height
  while (width % 2 === 0 && height % 2 === 0 && Math.min(width, height) / 2 >= 270) {
    width /= 2
    height /= 2
    choices.push({ width, height, label: `${width} × ${height}` })
  }
  return choices
}

export function exportRangeDurationMs(settings: Pick<ExportSettings, 'rangeStartMs' | 'rangeEndMs'>): number {
  return Math.max(0, settings.rangeEndMs - settings.rangeStartMs)
}

export function estimateOutputBytes(settings: ExportSettings): number {
  const seconds = exportRangeDurationMs(settings) / 1000
  if (settings.mode === 'audio') {
    return Math.round(seconds * EXPORT_SAMPLE_RATE) * 2 * 2 + 44
  }
  const preset = QUALITY_PRESETS[settings.quality]
  return Math.round(((preset.videoBitrate + preset.audioBitrate) * seconds) / 8)
}

export type PreflightIssue = { level: 'block' | 'warn'; message: string }

export function preflightExport(args: {
  settings: ExportSettings
  videoEncoderReady: boolean | null
  audioEncoderReady: boolean | null
  missingMedia: string[]
  mediaChecked: boolean
}): { ready: boolean; issues: PreflightIssue[] } {
  const issues: PreflightIssue[] = []
  const durationMs = exportRangeDurationMs(args.settings)
  if (
    args.settings.rangeStartMs < 0 ||
    args.settings.rangeEndMs <= args.settings.rangeStartMs
  ) {
    issues.push({ level: 'block', message: 'The export range is not a positive interval.' })
  } else if (durationMs <= 0) {
    issues.push({ level: 'block', message: 'The export range is empty.' })
  }

  if (!args.mediaChecked) {
    issues.push({ level: 'block', message: 'Media availability has not been checked yet.' })
  } else if (args.missingMedia.length > 0) {
    issues.push({
      level: 'block',
      message: `Missing media: ${args.missingMedia.join(', ')}.`,
    })
  }

  if (args.settings.mode === 'video') {
    if (args.videoEncoderReady == null || args.audioEncoderReady == null) {
      issues.push({ level: 'block', message: 'H.264 and AAC support have not been checked yet.' })
    } else {
      if (!args.videoEncoderReady) {
        issues.push({ level: 'block', message: 'H.264 video encoding is not available in this browser.' })
      }
      if (!args.audioEncoderReady) {
        issues.push({ level: 'block', message: 'AAC audio encoding is not available in this browser.' })
      }
    }
    if (![24, 25, 30, 60].includes(args.settings.frameRate)) {
      issues.push({ level: 'block', message: 'That frame rate is not rendered.' })
    }
  }

  const seconds = durationMs / 1000
  if (args.settings.mode === 'video' && seconds > 10 * 60) {
    issues.push({
      level: 'warn',
      message: 'This range is longer than 10 minutes and may use a lot of memory.',
    })
  }

  return { ready: !issues.some((issue) => issue.level === 'block'), issues }
}

export async function inspectExportReadiness(args: {
  document: ProjectDocument
  settings: ExportSettings
  probe: Mp4EncodeProbe
  mediaAvailable: (mediaSourceId: string) => Promise<boolean>
}): Promise<{ ready: boolean; issues: PreflightIssue[] }> {
  const range = { startMs: args.settings.rangeStartMs, endMs: args.settings.rangeEndMs }
  const missing: string[] = []
  for (const source of requiredMediaSources(args.document, range)) {
    if (!(await args.mediaAvailable(source.id))) missing.push(source.name)
  }
  let videoEncoderReady: boolean | null = true
  let audioEncoderReady: boolean | null = true
  if (args.settings.mode === 'video') {
    if (!args.probe.webCodecs) {
      videoEncoderReady = false
      audioEncoderReady = false
    } else {
      videoEncoderReady = await args.probe.canEncodeAvc(
        args.settings.width,
        args.settings.height,
        args.settings.frameRate,
      )
      audioEncoderReady = await args.probe.canEncodeAac()
    }
  }
  return preflightExport({
    settings: args.settings,
    videoEncoderReady,
    audioEncoderReady,
    missingMedia: missing,
    mediaChecked: true,
  })
}

export function formatByteEstimate(bytes: number): string {
  if (bytes < 1024 * 1024) return `About ${Math.max(1, Math.round(bytes / 1024))} KB`
  return `About ${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
