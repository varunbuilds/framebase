import { describe, expect, it } from 'vitest'
import { encodeWavPcm, readWavPcm } from './export-wav'
import { audioMixSampleOffset, mixIntoTimeline } from './export-plan'

describe('wav audio export', () => {
  it('writes a parseable file whose samples stay continuous across a packet boundary', () => {
    const rate = 48_000
    const frames = 1024
    const left = new Float32Array(frames * 2)
    const right = new Float32Array(frames * 2)
    const packet = new Float32Array(frames).fill(0.4)
    const second = audioMixSampleOffset({
      timelineStartMs: 0,
      sourceInMs: 0,
      sampleTimestampSec: frames / rate,
      sampleRate: rate,
    })
    mixIntoTimeline({
      destination: left,
      source: packet,
      sourceRate: rate,
      destinationRate: rate,
      destinationOffset: 0,
    })
    mixIntoTimeline({
      destination: left,
      source: packet,
      sourceRate: rate,
      destinationRate: rate,
      destinationOffset: second,
    })
    right.set(left)

    const wav = encodeWavPcm({ left, right, sampleRate: rate })
    const decoded = readWavPcm(wav)
    expect(decoded.sampleRate).toBe(rate)
    expect(decoded.channels).toBe(2)
    expect(decoded.frames / rate).toBeCloseTo((frames * 2) / rate, 5)
    expect(decoded.left[frames - 1]).toBeCloseTo(0.4, 2)
    expect(decoded.left[frames]).toBeCloseTo(0.4, 2)
    expect(Math.max(...decoded.left)).toBeLessThan(0.5)
  })
})
