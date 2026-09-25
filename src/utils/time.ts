import type { TimeMs } from '@/types/timeline'

/** Display/step frame rate used by timecode and arrow-key nudges. */
export const TIMELINE_FPS = 30
export const FRAME_DURATION_MS = 1000 / TIMELINE_FPS

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function msToSeconds(ms: TimeMs): number {
  return ms / 1000
}

export function secondsToMs(seconds: number): TimeMs {
  return Math.max(0, Math.round(seconds * 1000))
}

/** Move playhead by whole frames, snapping to the frame grid. */
export function stepPlayheadMs(ms: TimeMs, frames: number): TimeMs {
  const frameIndex = Math.round(ms / FRAME_DURATION_MS)
  return Math.max(0, Math.round((frameIndex + frames) * FRAME_DURATION_MS))
}

/** Nearest frame boundary. Stays on the grid so a hover playhead doesn't slide freely. */
export function snapToFrameMs(ms: TimeMs): TimeMs {
  const frameIndex = Math.round(ms / FRAME_DURATION_MS)
  return Math.max(0, Math.round(frameIndex * FRAME_DURATION_MS))
}

export function formatTimecode(ms: TimeMs): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const framesApprox = Math.floor((ms % 1000) / FRAME_DURATION_MS)

  const pad = (n: number, width = 2) => n.toString().padStart(width, '0')

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(framesApprox)}`
  }
  return `${pad(minutes)}:${pad(seconds)}.${pad(framesApprox)}`
}

export function formatDurationShort(ms: TimeMs): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function clipDurationMs(sourceInMs: TimeMs, sourceOutMs: TimeMs): TimeMs {
  return Math.max(0, sourceOutMs - sourceInMs)
}
