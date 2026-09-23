import { useEffect, useRef } from 'react'
import {
  getWaveformPeaks,
  samplePeakWindow,
} from '@/lib/media/waveform'

/** Cap drawing resolution so very wide (zoomed) clips stay responsive. */
const MAX_CANVAS_WIDTH = 1400
const MAX_SAMPLES = 420

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

    const sampleCount = Math.max(
      24,
      Math.min(MAX_SAMPLES, Math.floor(drawWidth / 1.5)),
    )
    const height = 72
    const midY = height / 2
    const amplitudeScale = height * 0.42

    canvas.width = drawWidth
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return

    const paintBackground = () => {
      context.clearRect(0, 0, drawWidth, height)
      context.fillStyle = '#16352c'
      context.fillRect(0, 0, drawWidth, height)
    }

    paintBackground()

    void getWaveformPeaks(mediaSourceId, src)
      .then((peaks) => {
        if (cancelled) return
        const samples = samplePeakWindow(
          peaks,
          sourceInMs,
          sourceOutMs,
          mediaDurationMs,
          sampleCount,
        )

        paintBackground()

        // Soft center guide like Premiere / Resolve audio lanes.
        context.strokeStyle = 'rgba(110, 220, 170, 0.18)'
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(0, midY)
        context.lineTo(drawWidth, midY)
        context.stroke()

        if (samples.length === 0) return

        const step = drawWidth / Math.max(1, samples.length - 1)

        // Continuous mirrored envelope — filled waveform, not discrete bars.
        context.beginPath()
        context.moveTo(0, midY)

        for (let index = 0; index < samples.length; index += 1) {
          const amplitude = samples[index] ?? 0
          const y = midY - Math.max(0.5, amplitude * amplitudeScale)
          const x = index * step
          if (index === 0) context.lineTo(x, y)
          else context.lineTo(x, y)
        }

        for (let index = samples.length - 1; index >= 0; index -= 1) {
          const amplitude = samples[index] ?? 0
          const y = midY + Math.max(0.5, amplitude * amplitudeScale)
          const x = index * step
          context.lineTo(x, y)
        }

        context.closePath()
        context.fillStyle = 'rgba(110, 220, 170, 0.55)'
        context.fill()

        context.strokeStyle = 'rgba(150, 235, 190, 0.9)'
        context.lineWidth = 1
        context.lineJoin = 'round'
        context.stroke()
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
