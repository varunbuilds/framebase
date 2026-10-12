export type ExportQueueStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type ExportQueueItem = {
  id: string
  label: string
  filename: string
  status: ExportQueueStatus
  progress: number | null
  message: string | null
}

export type ExportQueueEvent =
  | { type: 'enqueue'; item: ExportQueueItem }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number | null }
  | { type: 'complete'; id: string }
  | { type: 'fail'; id: string; message: string }
  | { type: 'cancel'; id: string }
  | { type: 'retry'; id: string }

export function reduceExportQueue(
  items: readonly ExportQueueItem[],
  event: ExportQueueEvent,
): ExportQueueItem[] {
  if (event.type === 'enqueue') {
    if (items.some((item) => item.id === event.item.id)) return [...items]
    return [...items, { ...event.item, status: 'queued', progress: null, message: null }]
  }
  return items.map((item) => {
    if (item.id !== event.id) return item
    if (event.type === 'start' && item.status === 'queued') {
      return { ...item, status: 'running', progress: null, message: null }
    }
    if (event.type === 'progress' && item.status === 'running') {
      return { ...item, progress: event.progress }
    }
    if (event.type === 'complete' && item.status === 'running') {
      return { ...item, status: 'completed', progress: 1, message: null }
    }
    if (event.type === 'fail' && item.status === 'running') {
      return { ...item, status: 'failed', message: event.message }
    }
    if (event.type === 'cancel' && (item.status === 'queued' || item.status === 'running')) {
      return { ...item, status: 'cancelled', message: null }
    }
    if (event.type === 'retry' && (item.status === 'failed' || item.status === 'cancelled')) {
      return { ...item, status: 'queued', progress: null, message: null }
    }
    return item
  })
}

export function runningExportId(items: readonly ExportQueueItem[]): string | null {
  return items.find((item) => item.status === 'running')?.id ?? null
}

export function nextQueuedExportId(items: readonly ExportQueueItem[]): string | null {
  if (runningExportId(items)) return null
  return items.find((item) => item.status === 'queued')?.id ?? null
}

/** A canceled run stays canceled even when the renderer later returns a file. */
export function exportRunDisposition(
  outcome: 'success' | 'failure' | 'canceled',
  userCanceled: boolean,
): 'complete' | 'fail' | 'cancel' {
  if (userCanceled || outcome === 'canceled') return 'cancel'
  return outcome === 'failure' ? 'fail' : 'complete'
}
