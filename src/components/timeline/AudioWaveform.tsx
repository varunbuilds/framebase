import { useEffect, useMemo, useState } from 'react'
import {
  getWaveformPeaks,
  samplePeakWindow,
} from '@/lib/media/waveform'

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
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getWaveformPeaks(mediaSourceId, src)
      .then((next) => {
        if (cancelled) return
        setPeaks(next)
        setLoadedFor(mediaSourceId)
      })
      .catch(() => {
        if (cancelled) return
        setPeaks(null)
        setLoadedFor(mediaSourceId)
      })
    return () => {
      cancelled = true
    }
  }, [mediaSourceId, src])

  const ready = loadedFor === mediaSourceId && peaks != null
  const barCount = Math.max(8, Math.min(240, Math.floor(widthPx / 2)))

  const bars = useMemo(() => {
    if (!ready || !peaks) return null
    return samplePeakWindow(
      peaks,
      sourceInMs,
      sourceOutMs,
      mediaDurationMs,
      barCount,
    )
  }, [barCount, mediaDurationMs, peaks, ready, sourceInMs, sourceOutMs])

  if (!bars) {
    return (
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, transparent 0 7px, rgba(22, 101, 52, 0.35) 8px 10px, transparent 11px 18px)',
        }}
        aria-hidden
      />
    )
  }

  const midY = 50

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-80"
      viewBox={`0 0 ${barCount * 2} 100`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {Array.from(bars, (amplitude, index) => {
        const height = Math.max(2, amplitude * 78)
        const x = index * 2
        return (
          <rect
            key={index}
            x={x}
            y={midY - height / 2}
            width={1.4}
            height={height}
            rx={0.4}
            fill="rgb(21 128 61)"
          />
        )
      })}
    </svg>
  )
}
