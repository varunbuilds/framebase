/**
 * Waveform peaks keyed by media source id.
 * The in-memory envelope is rebuilt from OPFS when possible. Missing peaks are
 * decoded from source media. Neither cache is part of ProjectDocument.
 */
import {
  getDerivedCacheStore,
  putDerivedCache,
  readDerivedCache,
  waveformCacheKey,
} from './derived-cache'

const peaksCache = new Map<string, Float32Array>()
const inflight = new Map<string, Promise<Float32Array>>()

/** Dense enough for sharp zoomed-in clip waveforms. */
const DEFAULT_PEAK_COUNT = 16_000

function mixChannels(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer
  if (numberOfChannels === 1) {
    return buffer.getChannelData(0).slice()
  }

  const mixed = new Float32Array(length)
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      mixed[i] += data[i] / numberOfChannels
    }
  }
  return mixed
}

function extractPeaks(samples: Float32Array, peakCount: number): Float32Array {
  const peaks = new Float32Array(peakCount)
  const blockSize = Math.max(1, Math.floor(samples.length / peakCount))

  for (let i = 0; i < peakCount; i += 1) {
    const start = i * blockSize
    const end = Math.min(samples.length, start + blockSize)
    let max = 0
    for (let sample = start; sample < end; sample += 1) {
      const value = Math.abs(samples[sample] ?? 0)
      if (value > max) max = value
    }
    peaks[i] = max
  }

  // Soft normalize so quiet clips remain visible without blowing out loud ones.
  let peakMax = 0
  for (let i = 0; i < peaks.length; i += 1) {
    peakMax = Math.max(peakMax, peaks[i] ?? 0)
  }
  if (peakMax > 0) {
    const scale = 1 / peakMax
    for (let i = 0; i < peaks.length; i += 1) {
      peaks[i] = (peaks[i] ?? 0) * scale
    }
  }

  return peaks
}

async function decodePeaks(objectUrl: string, peakCount: number): Promise<Float32Array> {
  const response = await fetch(objectUrl)
  if (!response.ok) {
    throw new Error('Failed to read media for waveform.')
  }
  const arrayBuffer = await response.arrayBuffer()
  const audioContext = new AudioContext()
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const mixed = mixChannels(audioBuffer)
    return extractPeaks(mixed, peakCount)
  } finally {
    await audioContext.close()
  }
}

export function encodeWaveformPeaks(peaks: Float32Array): Blob {
  const bytes = peaks.buffer.slice(
    peaks.byteOffset,
    peaks.byteOffset + peaks.byteLength,
  ) as ArrayBuffer
  return new Blob([bytes], { type: 'application/octet-stream' })
}

export function decodeWaveformPeaks(buffer: ArrayBuffer): Float32Array | null {
  if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) return null
  return new Float32Array(buffer.slice(0))
}

/** Read a persisted envelope. A miss or corrupt file returns null and can be regenerated. */
export async function readCachedWaveform(
  mediaSourceId: string,
  peakCount: number,
): Promise<Float32Array | null> {
  const cacheKey = waveformCacheKey(peakCount)
  const blob = await readDerivedCache(mediaSourceId, cacheKey)
  if (!blob) return null
  const peaks = decodeWaveformPeaks(await blob.arrayBuffer())
  if (!peaks || peaks.length < peakCount) {
    await getDerivedCacheStore().invalidate(mediaSourceId, cacheKey).catch(() => undefined)
    return null
  }
  return peaks
}

export function getWaveformPeaks(
  mediaSourceId: string,
  objectUrl: string,
  peakCount = DEFAULT_PEAK_COUNT,
): Promise<Float32Array> {
  const cached = peaksCache.get(mediaSourceId)
  // Re-decode if an older, coarser cache entry exists.
  if (cached && cached.length >= peakCount) {
    return Promise.resolve(cached)
  }

  const flightKey = `${mediaSourceId}:${peakCount}`
  const existing = inflight.get(flightKey)
  if (existing) return existing

  const promise = loadOrDecodePeaks(mediaSourceId, objectUrl, peakCount).finally(() => {
    if (inflight.get(flightKey) === promise) inflight.delete(flightKey)
  })

  inflight.set(flightKey, promise)
  return promise
}

async function loadOrDecodePeaks(
  mediaSourceId: string,
  objectUrl: string,
  peakCount: number,
): Promise<Float32Array> {
  const stored = await readCachedWaveform(mediaSourceId, peakCount)
  if (stored) {
    rememberPeaks(mediaSourceId, stored)
    return stored
  }
  const peaks = await decodePeaks(objectUrl, peakCount)
  rememberPeaks(mediaSourceId, peaks)
  void putDerivedCache(mediaSourceId, waveformCacheKey(peakCount), encodeWaveformPeaks(peaks))
  return peaks
}

function rememberPeaks(mediaSourceId: string, peaks: Float32Array): void {
  const current = peaksCache.get(mediaSourceId)
  if (!current || peaks.length >= current.length) {
    peaksCache.set(mediaSourceId, peaks)
  }
}

/** Drop in-memory peaks. Pass no id to drop every source. Does not delete OPFS copies. */
export function clearWaveformPeaks(mediaSourceId?: string): void {
  if (!mediaSourceId) {
    peaksCache.clear()
    inflight.clear()
    return
  }
  peaksCache.delete(mediaSourceId)
  const prefix = `${mediaSourceId}:`
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key)
  }
}

export function retainWaveformPeaks(keep: ReadonlySet<string>): void {
  for (const mediaSourceId of peaksCache.keys()) {
    if (!keep.has(mediaSourceId)) clearWaveformPeaks(mediaSourceId)
  }
}

/**
 * Sample a window of full-file peaks into `barCount` display bars for a
 * source-in/source-out range. Upsamples with linear interpolation when the
 * window has fewer peaks than display columns (avoids blocky stairs).
 */
export function samplePeakWindow(
  peaks: Float32Array,
  sourceInMs: number,
  sourceOutMs: number,
  mediaDurationMs: number,
  barCount: number,
): Float32Array {
  if (peaks.length === 0 || barCount <= 0 || mediaDurationMs <= 0) {
    return new Float32Array(Math.max(0, barCount))
  }

  const startRatio = clamp01(sourceInMs / mediaDurationMs)
  const endRatio = clamp01(sourceOutMs / mediaDurationMs)
  const startIndex = Math.floor(startRatio * peaks.length)
  const endIndex = Math.max(startIndex + 1, Math.ceil(endRatio * peaks.length))
  const windowSize = endIndex - startIndex
  const sampled = new Float32Array(barCount)

  if (windowSize <= 1) {
    const value = peaks[startIndex] ?? 0
    sampled.fill(value)
    return sampled
  }

  if (windowSize < barCount) {
    // Upsample — interpolate so zoomed clips stay smooth instead of stepped.
    for (let i = 0; i < barCount; i += 1) {
      const pos =
        startIndex + (i / Math.max(1, barCount - 1)) * (windowSize - 1)
      const lo = Math.floor(pos)
      const hi = Math.min(endIndex - 1, lo + 1)
      const t = pos - lo
      sampled[i] = (peaks[lo] ?? 0) * (1 - t) + (peaks[hi] ?? 0) * t
    }
    return sampled
  }

  for (let i = 0; i < barCount; i += 1) {
    const relStart = Math.floor((i / barCount) * windowSize)
    const relEnd = Math.floor(((i + 1) / barCount) * windowSize)
    let max = 0
    for (
      let j = startIndex + relStart;
      j < startIndex + Math.max(relEnd, relStart + 1);
      j += 1
    ) {
      max = Math.max(max, peaks[j] ?? 0)
    }
    sampled[i] = max
  }

  return sampled
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
