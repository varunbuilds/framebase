import { describe, expect, it } from 'vitest'
import { samplePeakWindow } from '@/lib/media/waveform'

describe('samplePeakWindow', () => {
  it('samples the trimmed source window into display bars', () => {
    const peaks = Float32Array.from({ length: 100 }, (_, i) => i / 100)
    const sampled = samplePeakWindow(peaks, 2500, 7500, 10_000, 4)
    expect(sampled.length).toBe(4)
    // Window covers peaks ~25..75; bars should rise through that range.
    expect(sampled[0]!).toBeGreaterThan(0.2)
    expect(sampled[3]!).toBeGreaterThan(sampled[0]!)
  })

  it('returns empty bars for invalid inputs', () => {
    expect(samplePeakWindow(new Float32Array(0), 0, 1000, 1000, 8).length).toBe(8)
    expect(samplePeakWindow(new Float32Array([1]), 0, 1000, 0, 4).length).toBe(4)
  })
})
