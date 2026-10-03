const STORAGE_KEY = 'framebase.feedback.sends'
/** If this many sends land inside the burst window, apply the lockout. */
const MAX_BURST = 3
/** Window used to detect a burst. */
const BURST_WINDOW_MS = 30_000
/** Wait after a burst, measured from the latest send. */
const LOCKOUT_MS = 60_000

function readSends(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  } catch {
    return []
  }
}

function writeSends(sends: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sends))
  } catch {
    // Private mode / quota — rate limit still applies for this session via memory.
  }
}

function prune(sends: number[], now: number) {
  return sends
    .filter((stamp) => now - stamp < LOCKOUT_MS + BURST_WINDOW_MS)
    .slice(-20)
}

export type FeedbackRateLimit = {
  allowed: boolean
  retryAfterMs: number
  reason: 'window' | null
}

export function getFeedbackRateLimit(now = Date.now()): FeedbackRateLimit {
  const recent = prune(readSends(), now)
  if (recent.length >= MAX_BURST) {
    const burst = recent.slice(-MAX_BURST)
    const oldest = burst[0]
    const latest = burst[MAX_BURST - 1]
    if (oldest != null && latest != null && latest - oldest <= BURST_WINDOW_MS) {
      const remaining = LOCKOUT_MS - (now - latest)
      if (remaining > 0) {
        return {
          allowed: false,
          retryAfterMs: remaining,
          reason: 'window',
        }
      }
    }
  }
  return { allowed: true, retryAfterMs: 0, reason: null }
}

export function recordFeedbackSend(now = Date.now()) {
  const recent = prune(readSends(), now)
  recent.push(now)
  writeSends(recent)
}

export function formatFeedbackWait(ms: number): string {
  const totalSec = Math.max(1, Math.ceil(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const minutes = Math.ceil(totalSec / 60)
  return minutes === 1 ? '1 min' : `${minutes} min`
}
