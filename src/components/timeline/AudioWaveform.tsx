import { useEffect, useRef } from 'react'
import {
  getWaveformPeaks,
  samplePeakWindow,
} from '@/lib/media/waveform'

/** Cap drawing resolution so very wide (zoomed) clips stay responsive. */
const MAX_CANVAS_WIDTH = 960
const MAX_BARS = 180

function cappedDrawWidth(widthPx: number): number {
  return Math.max(8, Math.min(MAX_CANVAS_WIDTH, Math.floor(widthPx) || 8))
}

export function AudioWaveform({
  mediaSourceId,
  src,
  sourceInMs,
  sourceOutMs,
  mediaDurationMs,
  widthPx,
}: {
  mediaSourceId: string
  src: string
  sourceInMs: number
  sourceOutMs: number
  mediaDurationMs: number
  widthPx: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawWidth = cappedDrawWidth(widthPx)

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const barCount = Math.max(8, Math.min(MAX_BARS, Math.floor(drawWidth / 3)))
    const height = 64

    canvas.width = drawWidth
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return

    context.clearRect(0, 0, drawWidth, height)
    context.fillStyle = '#16352c'
    context.fillRect(0, 0, drawWidth, height)

    void getWaveformPeaks(mediaSourceId, src)
      .then((peaks) => {
        if (cancelled) return
        const bars = samplePeakWindow(
          peaks,
          sourceInMs,
          sourceOutMs,
          mediaDurationMs,
          barCount,
        )
        context.clearRect(0, 0, drawWidth, height)
        context.fillStyle = '#16352c'
        context.fillRect(0, 0, drawWidth, height)
        context.fillStyle = 'rgba(110, 220, 170, 0.85)'

        const midY = height / 2
        const step = drawWidth / barCount
        for (let index = 0; index < bars.length; index += 1) {
          const amplitude = bars[index] ?? 0
          const barHeight = Math.max(2, amplitude * (height * 0.82))
          const x = index * step
          context.fillRect(
            x,
            midY - barHeight / 2,
            Math.max(1, step * 0.7),
            barHeight,
          )
        }
      })
      .catch(() => {
        // Keep the solid fallback fill already painted.
      })

    return () => {
      cancelled = true
    }
  }, [drawWidth, mediaDurationMs, mediaSourceId, sourceInMs, sourceOutMs, src])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none h-full w-full"
      aria-hidden
    />
  )
}
