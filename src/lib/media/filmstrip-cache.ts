/** Runtime filmstrip frames keyed by object URL and source time. Not part of ProjectDocument. */

const frames = new Map<string, string>()

function frameKey(objectUrl: string, timeMs: number): string {
  return `${objectUrl}|${timeMs}`
}

export function hasFilmstripFrame(objectUrl: string, timeMs: number): boolean {
  return frames.has(frameKey(objectUrl, timeMs))
}

export function getFilmstripFrame(
  objectUrl: string,
  timeMs: number,
): string | undefined {
  return frames.get(frameKey(objectUrl, timeMs))
}

export function setFilmstripFrame(
  objectUrl: string,
  timeMs: number,
  dataUrl: string,
): void {
  frames.set(frameKey(objectUrl, timeMs), dataUrl)
}

/** Drop cached frames for one runtime object URL. Call before that URL is revoked. */
export function clearFilmstripFramesForObjectUrl(objectUrl: string): void {
  const prefix = `${objectUrl}|`
  for (const key of frames.keys()) {
    if (key.startsWith(prefix)) frames.delete(key)
  }
}
