import type { CanvasAspectRatio, ProjectDocument } from '@/types/timeline'

/** Preview gap color. Letterboxing and timeline gaps use the same fill. */
export const EXPORT_BACKGROUND = '#181e22'

export const EXPORT_FPS = 30

export const EXPORT_SAMPLE_RATE = 48_000

export const EXPORT_CHANNELS = 2

export const EXPORT_CONTAINER = 'video/mp4'

export const EXPORT_SIZES: Record<
  CanvasAspectRatio,
  { width: number; height: number }
> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
}

export type ExportSize = {
  width: number
  height: number
  label: string
}

export type ExportProgress = {
  phase: 'preparing' | 'rendering' | 'finalizing'
  /** Frames completed over frames required. Null when this phase has no measured amount. */
  fraction: number | null
}

export type ExportAudioSpan = {
  mediaSourceId: string
  mediaName: string
  timelineStartMs: number
  sourceInMs: number
  sourceOutMs: number
}

export type ExportPicture =
  | { kind: 'gap' }
  | {
      kind: 'frame'
      clipId: string
      mediaSourceId: string
      mediaName: string
      sourceTimeMs: number
    }

export class ExportFailure extends Error {
  /** Original error text for the dialog. Not a stack trace. */
  readonly detail: string

  constructor(
    message: string,
    options?: { cause?: unknown; detail?: string },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ExportFailure'
    this.detail = options?.detail ?? message
  }
}

export class ExportCanceled extends Error {
  constructor() {
    super('Export canceled.')
    this.name = 'ExportCanceled'
  }
}

export function isExportCanceled(error: unknown): boolean {
  return error instanceof ExportCanceled
}

export type ExportJob =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'rendering'; percent: number }
  | { status: 'finalizing'; percent: number }
  | { status: 'complete'; filename: string }
  | { status: 'failed'; message: string; detail: string }
  | { status: 'canceled' }

export type ExportEvent =
  | { type: 'start' }
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'complete'; filename: string }
  | { type: 'fail'; message: string; detail: string }
  | { type: 'cancel' }
  | { type: 'reset' }

export type ExportRequest = {
  snapshot: ProjectDocument
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
}
