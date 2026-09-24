import { useEffect, useRef } from 'react'
import {
  getWaveformPeaks,
  samplePeakWindow,
} from '@/lib/media/waveform'

/** Cap CSS width so extremely zoomed clips stay drawable. */
const MAX_CSS_WIDTH = 2400

function cappedCssWidth(widthPx: number): number {
  return Math.max(8, Math.min(MAX_CSS_WIDTH, Math.floor(widthPx) || 8))
}

/**
 * Resolve/Premiere-style audio lane: dense vertical stems at device-pixel
 * resolution (not a soft filled blob).
 */
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
  const cssWidth = cappedCssWidth(widthPx)

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const cssHeight = 80
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr))
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr))
    // One stem per device pixel for a crisp NLE look.
    const sampleCount = pixelWidth

    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    const context = canvas.getContext('2d')
    if (!context) return

    // Draw in device pixels — avoids subpixel blur from CSS scaling.
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.imageSmoothingEnabled = false

    const paintBackground = () => {
      context.clearRect(0, 0, pixelWidth, pixelHeight)
      context.fillStyle = '#16352c'
      context.fillRect(0, 0, pixelWidth, pixelHeight)
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

        const midY = pixelHeight / 2
        const amplitudeScale = pixelHeight * 0.46

        // Center guide
        context.fillStyle = 'rgba(110, 220, 170, 0.22)'
        context.fillRect(0, Math.round(midY), pixelWidth, 1)

        // Dense vertical stems (classic timeline waveform).
        context.fillStyle = 'rgba(130, 230, 185, 0.92)'
        for (let x = 0; x < samples.length; x += 1) {
          const amplitude = samples[x] ?? 0
          const half = Math.max(1, Math.round(amplitude * amplitudeScale))
          context.fillRect(x, Math.round(midY - half), 1, half * 2)
        }
      })
      .catch(() => {
        // Keep the solid fallback fill already painted.
      })

    return () => {
      cancelled = true
    }
  }, [cssWidth, mediaDurationMs, mediaSourceId, sourceInMs, sourceOutMs, src])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none h-full w-full"
      aria-hidden
    />
  )
}
