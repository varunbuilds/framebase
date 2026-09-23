import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { MediaKind, MediaSource } from '@/types/timeline'
import { createId } from '@/utils/id'
import { secondsToMs } from '@/utils/time'
import { setObjectUrl } from './object-urls'

export type ImportMediaResult =
  | { ok: true; source: MediaSource; linkedAudioSource?: MediaSource; objectUrl: string }
  | { ok: false; error: string }

function inferKindFromMime(mimeType: string, fileName: string): MediaKind | null {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'

  const lower = fileName.toLowerCase()
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(lower)) return 'video'
  if (/\.(mp3|wav|aac|m4a|ogg|flac)$/.test(lower)) return 'audio'
  return null
}

async function readDurationWithVideoElement(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file)
  try {
    const durationSeconds = await new Promise<number | null>((resolve) => {
      const el = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video')
      el.preload = 'metadata'
      const cleanup = () => {
        el.removeAttribute('src')
        el.load()
      }
      el.onloadedmetadata = () => {
        const value = Number.isFinite(el.duration) ? el.duration : null
        cleanup()
        resolve(value)
      }
      el.onerror = () => {
        cleanup()
        resolve(null)
      }
      el.src = url
    })
    return durationSeconds
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function probeWithMediabunny(file: File): Promise<{
  durationMs: number
  kind: MediaKind
  width?: number
  height?: number
  sampleRate?: number
  channelCount?: number
  hasAudio: boolean
  mimeType: string
}> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  })

  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()

    let durationSeconds =
      (await input.getDurationFromMetadata()) ?? (await input.computeDuration())

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      const fallback = await readDurationWithVideoElement(file)
      if (fallback == null || fallback <= 0) {
        throw new Error('Could not determine media duration.')
      }
      durationSeconds = fallback
    }

    if (videoTrack) {
      const width = await videoTrack.getDisplayWidth()
      const height = await videoTrack.getDisplayHeight()
      return {
        durationMs: secondsToMs(durationSeconds),
        kind: 'video',
        width,
        height,
        mimeType: file.type || 'video/*',
        hasAudio: Boolean(audioTrack),
      }
    }

    if (audioTrack) {
      const sampleRate = await audioTrack.getSampleRate()
      const channelCount = await audioTrack.getNumberOfChannels()
      return {
        durationMs: secondsToMs(durationSeconds),
        kind: 'audio',
        sampleRate,
        channelCount,
        mimeType: file.type || 'audio/*',
        hasAudio: false,
      }
    }

    throw new Error('No playable video or audio track found in this file.')
  } finally {
    // Input holds references; dispose if available in this version
    if (typeof (input as { dispose?: () => void }).dispose === 'function') {
      ;(input as { dispose: () => void }).dispose()
    }
  }
}

export async function importLocalMediaFile(file: File): Promise<ImportMediaResult> {
  const inferred = inferKindFromMime(file.type, file.name)
  if (!inferred) {
    return {
      ok: false,
      error: `"${file.name}" is not a supported video or audio file.`,
    }
  }

  try {
    const probed = await probeWithMediabunny(file)
    const id = createId('media')
    const objectUrl = URL.createObjectURL(file)
    setObjectUrl(id, objectUrl)
    const linkedAudioId = probed.kind === 'video' && probed.hasAudio
      ? createId('media')
      : undefined

    const source: MediaSource = {
      id,
      name: file.name,
      kind: probed.kind,
      durationMs: probed.durationMs,
      mimeType: probed.mimeType || file.type || 'application/octet-stream',
      width: probed.width,
      height: probed.height,
      sampleRate: probed.sampleRate,
      channelCount: probed.channelCount,
      availability: 'ready',
      importedAt: new Date().toISOString(),
      linkedMediaSourceId: linkedAudioId,
    }
    const linkedAudioSource = linkedAudioId
      ? {
          id: linkedAudioId,
          name: file.name,
          kind: 'audio' as const,
          durationMs: probed.durationMs,
          mimeType: probed.mimeType,
          availability: 'ready' as const,
          importedAt: source.importedAt,
          linkedMediaSourceId: id,
        }
      : undefined
    if (linkedAudioSource) {
      setObjectUrl(linkedAudioSource.id, URL.createObjectURL(file))
    }

    return { ok: true, source, linkedAudioSource, objectUrl }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to import media file.'
    return { ok: false, error: `Could not import "${file.name}": ${message}` }
  }
}

export const MEDIA_ACCEPT =
  'video/*,audio/*,.mp4,.webm,.mov,.m4v,.mkv,.mp3,.wav,.aac,.m4a,.ogg,.flac'
