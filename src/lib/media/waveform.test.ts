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

  it('upsamples short windows without blocky stairs', () => {
    const peaks = Float32Array.from([0, 1])
    const sampled = samplePeakWindow(peaks, 0, 1000, 1000, 5)
    expect(sampled.length).toBe(5)
    expect(sampled[0]!).toBeCloseTo(0, 5)
    expect(sampled[4]!).toBeCloseTo(1, 5)
    expect(sampled[2]!).toBeGreaterThan(0.4)
    expect(sampled[2]!).toBeLessThan(0.6)
  })
})
