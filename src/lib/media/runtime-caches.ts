import { clearFilmstripFrames, retainFilmstripFrames } from './filmstrip-cache'
import { clearWaveformPeaks, retainWaveformPeaks } from './waveform'

/** Drop session copies of derived media. OPFS source files and OPFS caches stay. */
export function clearRuntimeDerivedCaches(): void {
  clearFilmstripFrames()
  clearWaveformPeaks()
}

export function retainRuntimeDerivedCaches(keep: ReadonlySet<string>): void {
  retainFilmstripFrames(keep)
  retainWaveformPeaks(keep)
}
