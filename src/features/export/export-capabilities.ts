import { canEncodeAudio, canEncodeVideo, Quality } from 'mediabunny'
import { logExport, logExportError, reportExportError } from './export-log'
import { ExportFailure, type ExportSize } from './export-types'

export const EXPORT_VIDEO_BITRATE = 8_000_000
export const EXPORT_AUDIO_BITRATE = 192_000

/**
 * Mediabunny 1.59 rejects an encoding config that sets both `quality` and
 * `bitrate`. Bitrate lives inside Quality.
 */
export function videoExportEncoding(videoBitrate = EXPORT_VIDEO_BITRATE) {
  return {
    codec: 'avc' as const,
    keyFrameInterval: 2,
    quality: new Quality({ bitrate: videoBitrate, bitrateMode: 'variable' as const }),
  }
}

export function audioExportEncoding(audioBitrate = EXPORT_AUDIO_BITRATE) {
  return {
    codec: 'aac' as const,
    quality: new Quality({ bitrate: audioBitrate, bitrateMode: 'variable' as const }),
  }
}

export type Mp4EncodeProbe = {
  webCodecs: boolean
  canEncodeAvc: (width: number, height: number, frameRate?: number) => Promise<boolean>
  canEncodeAac: () => Promise<boolean>
}

const H264_UNAVAILABLE =
  "Export couldn't start because H.264 video encoding isn't available in this browser."

const AAC_UNAVAILABLE =
  "Export couldn't start because AAC audio encoding isn't available in this browser."

export function webCodecsAvailability(): Record<string, string> {
  return {
    VideoEncoder: typeof VideoEncoder,
    VideoDecoder: typeof VideoDecoder,
    AudioEncoder: typeof AudioEncoder,
    AudioDecoder: typeof AudioDecoder,
  }
}

export function browserMp4Probe(options?: {
  videoBitrate?: number
  audioBitrate?: number
}): Mp4EncodeProbe {
  const videoBitrate = options?.videoBitrate ?? EXPORT_VIDEO_BITRATE
  const audioBitrate = options?.audioBitrate ?? EXPORT_AUDIO_BITRATE
  return {
    webCodecs:
      typeof VideoEncoder !== 'undefined' &&
      typeof AudioEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined',
    canEncodeAvc: (width, height, frameRate = 30) =>
      canEncodeVideo('avc', {
        width,
        height,
        frameRate,
        quality: new Quality({ bitrate: videoBitrate, bitrateMode: 'variable' }),
      }),
    canEncodeAac: () =>
      canEncodeAudio('aac', {
        numberOfChannels: 2,
        sampleRate: 48_000,
        quality: new Quality({ bitrate: audioBitrate, bitrateMode: 'variable' }),
      }),
  }
}

/**
 * Null when this browser can encode the MP4 this export will write.
 * A thrown probe is reported as that error, not as "unsupported".
 */
export async function mp4ExportBlocker(
  probe: Mp4EncodeProbe,
  size: Pick<ExportSize, 'width' | 'height'>,
  audioRequired: boolean,
  frameRate = 30,
): Promise<string | null> {
  logExport('Capability check', {
    ...webCodecsAvailability(),
    width: size.width,
    height: size.height,
    audioRequired,
  })

  if (!probe.webCodecs) return H264_UNAVAILABLE

  let videoSupported: boolean
  try {
    videoSupported = await probe.canEncodeAvc(size.width, size.height, frameRate)
  } catch (error) {
    logExportError(error)
    const report = reportExportError(error)
    throw new ExportFailure(
      "Export couldn't check H.264 video encoding in this browser.",
      { cause: error, detail: report.detail },
    )
  }
  logExport('Capability check', { avc: videoSupported })
  if (!videoSupported) return H264_UNAVAILABLE

  if (!audioRequired) return null

  let audioSupported: boolean
  try {
    audioSupported = await probe.canEncodeAac()
  } catch (error) {
    logExportError(error)
    const report = reportExportError(error)
    throw new ExportFailure(
      "Export couldn't check AAC audio encoding in this browser.",
      { cause: error, detail: report.detail },
    )
  }
  logExport('Capability check', { aac: audioSupported })
  if (!audioSupported) return AAC_UNAVAILABLE
  return null
}
