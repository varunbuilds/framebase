import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { isWorkspaceReady } from '@/lib/workspace/workspace-manager'
import type { MediaKind, MediaSource } from '@/types/timeline'
import { createId } from '@/utils/id'
import { secondsToMs } from '@/utils/time'
import { MediaStoreUnavailableError } from './media-byte-store'
import { deleteStoredMedia } from './delete-stored-media'
import { saveMedia } from './opfs-media-store'
import { revokeObjectUrl, setObjectUrl } from './object-urls'

export type ImportMediaResult =
  | { ok: true; source: MediaSource; objectUrl: string }
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
  hasVideo: boolean
  hasAudio: boolean
  width?: number
  height?: number
  fps?: number
  sampleRate?: number
  channelCount?: number
  mimeType: string
  videoCodec?: string
  audioCodec?: string
  videoCodecSupported?: boolean
  audioCodecSupported?: boolean
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
      const videoCodec = await optionalCodec(videoTrack)
      const videoCodecSupported = await optionalCanDecode(videoTrack)
      const fps = await optionalFrameRate(videoTrack)
      let sampleRate: number | undefined
      let channelCount: number | undefined
      let audioCodec: string | undefined
      let audioCodecSupported: boolean | undefined
      if (audioTrack) {
        sampleRate = await audioTrack.getSampleRate()
        channelCount = await audioTrack.getNumberOfChannels()
        audioCodec = await optionalCodec(audioTrack)
        audioCodecSupported = await optionalCanDecode(audioTrack)
      }
      return {
        durationMs: secondsToMs(durationSeconds),
        kind: 'video',
        hasVideo: true,
        hasAudio: Boolean(audioTrack),
        width,
        height,
        fps,
        sampleRate,
        channelCount,
        mimeType: file.type || 'video/*',
        videoCodec,
        audioCodec,
        videoCodecSupported,
        audioCodecSupported,
      }
    }

    if (audioTrack) {
      const sampleRate = await audioTrack.getSampleRate()
      const channelCount = await audioTrack.getNumberOfChannels()
      return {
        durationMs: secondsToMs(durationSeconds),
        kind: 'audio',
        hasVideo: false,
        hasAudio: true,
        sampleRate,
        channelCount,
        mimeType: file.type || 'audio/*',
        audioCodec: await optionalCodec(audioTrack),
        audioCodecSupported: await optionalCanDecode(audioTrack),
      }
    }

    throw new Error('No playable video or audio track found in this file.')
  } finally {
    if (typeof (input as { dispose?: () => void }).dispose === 'function') {
      ;(input as { dispose: () => void }).dispose()
    }
  }
}

async function optionalCodec(track: {
  getCodec: () => Promise<string | null>
}): Promise<string | undefined> {
  try {
    const codec = await track.getCodec()
    return codec ?? undefined
  } catch {
    return undefined
  }
}

async function optionalCanDecode(track: {
  canDecode: () => Promise<boolean>
}): Promise<boolean | undefined> {
  try {
    return await track.canDecode()
  } catch {
    return undefined
  }
}

async function optionalFrameRate(track: {
  computePacketStats: (count?: number) => Promise<{ averagePacketRate: number }>
}): Promise<number | undefined> {
  try {
    const stats = await track.computePacketStats(64)
    return Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0
      ? stats.averagePacketRate
      : undefined
  } catch {
    return undefined
  }
}

async function captureRepresentativeJpeg(file: Blob): Promise<Blob | undefined> {
  if (typeof document === 'undefined') return undefined
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('thumbnail'))
    })
    if (!video.videoWidth || !video.videoHeight) return undefined
    const time = Number.isFinite(video.duration) ? Math.min(0.5, video.duration / 2) : 0
    if (time > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
        video.currentTime = time
      })
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.82)
    })
    return blob ?? undefined
  } catch {
    return undefined
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
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
  if (!isWorkspaceReady()) {
    return {
      ok: false,
      error: 'Choose a local workspace before importing media.',
    }
  }

  const id = createId('media')
  try {
    const probed = await probeWithMediabunny(file)
    const thumbnail = probed.hasVideo ? await captureRepresentativeJpeg(file) : undefined
    await saveMedia(id, file, {
      name: file.name,
      mimeType: file.type || probed.mimeType || 'application/octet-stream',
      fileSize: file.size,
      durationMs: probed.durationMs,
      width: probed.width,
      height: probed.height,
      fps: probed.fps,
      hasVideo: probed.hasVideo,
      hasAudio: probed.hasAudio,
      videoCodec: probed.videoCodec,
      audioCodec: probed.audioCodec,
      sampleRate: probed.sampleRate,
      channelCount: probed.channelCount,
      videoCodecSupported: probed.videoCodecSupported,
      audioCodecSupported: probed.audioCodecSupported,
      thumbnail,
    })
    const objectUrl = URL.createObjectURL(file)
    setObjectUrl(id, objectUrl)

    const source: MediaSource = {
      id,
      name: file.name,
      kind: probed.kind,
      hasVideo: probed.hasVideo,
      hasAudio: probed.hasAudio,
      durationMs: probed.durationMs,
      mimeType: probed.mimeType || file.type || 'application/octet-stream',
      width: probed.width,
      height: probed.height,
      sampleRate: probed.sampleRate,
      channelCount: probed.channelCount,
      locator: { kind: 'local', key: id },
      availability: 'available',
      importedAt: new Date().toISOString(),
    }

    return { ok: true, source, objectUrl }
  } catch (error) {
    await deleteStoredMedia(id).catch(() => undefined)
    const message =
      error instanceof MediaStoreUnavailableError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to import media file.'
    return { ok: false, error: `Could not import "${file.name}": ${message}` }
  }
}

/** Drops a source that was stored but never added to the document. */
export async function discardImportedMedia(source: MediaSource): Promise<void> {
  revokeObjectUrl(source.id)
  if (source.locator.kind === 'opfs' || source.locator.kind === 'local') {
    await deleteStoredMedia(source.locator.key).catch(() => undefined)
  }
}

export const MEDIA_ACCEPT =
  'video/*,audio/*,.mp4,.webm,.mov,.m4v,.mkv,.mp3,.wav,.aac,.m4a,.ogg,.flac'
