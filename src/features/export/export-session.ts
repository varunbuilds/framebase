import type { ProjectDocument } from '@/types/timeline'
import { reportExportError } from './export-log'
import {
  nextQueuedExportId,
  reduceExportQueue,
  type ExportQueueItem,
} from './export-queue'
import { exportDownloadName, QUALITY_PRESETS, type ExportSettings } from './export-settings'
import { isExportCanceled, type ExportProgress } from './export-types'

export type ExportRenderRequest = {
  snapshot: ProjectDocument
  settings: ExportSettings
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
}

export type ExportClick =
  | { type: 'start'; settings: ExportSettings }
  | { type: 'blocked'; message: string }

export function explainExportBlock(message: string): string {
  if (message.startsWith('Checking')) return message
  if (message.startsWith('Enter a file name')) return 'Enter a file name before exporting.'
  if (message.includes('not a positive interval') || message.includes('range is empty')) {
    return `${message} Set the end later than the start, or choose the whole timeline.`
  }
  if (message.startsWith('Missing media')) {
    return `${message} Re-import those files, then export again.`
  }
  if (message.includes('H.264')) {
    return `${message} Export audio only, or use a browser that can encode H.264.`
  }
  if (message.includes('AAC')) {
    return `${message} Export audio only, or use a browser that can encode AAC.`
  }
  return message
}

/** What the final Export button does. A block is a visible reason, never a silent return. */
export function exportClickResult(args: {
  settings: ExportSettings
  readiness: { ready: boolean; issues: { level: 'block' | 'warn'; message: string }[] }
}): ExportClick {
  const name = args.settings.fileBaseName?.trim() ?? ''
  if (!name) return { type: 'blocked', message: explainExportBlock('Enter a file name.') }
  const blockers = args.readiness.issues.filter(
    (issue) => issue.level === 'block' && !issue.message.startsWith('Checking'),
  )
  const blocker = blockers[0]
  if (blocker) return { type: 'blocked', message: explainExportBlock(blocker.message) }
  return { type: 'start', settings: { ...args.settings, fileBaseName: name } }
}

type StoredJob = {
  snapshot: ProjectDocument
  settings: ExportSettings
}

export function createExportSession(deps: {
  render: (request: ExportRenderRequest) => Promise<{ blob: Blob; filename: string }>
  downloadFile: (blob: Blob, filename: string) => void
  snapshot: () => ProjectDocument
  createId?: () => string
  onChange?: (items: readonly ExportQueueItem[]) => void
}) {
  let items: ExportQueueItem[] = []
  let runningId: string | null = null
  let attached = true
  let abort: AbortController | null = null
  const canceled = new Set<string>()
  const stored = new Map<string, StoredJob>()
  const files = new Map<string, { blob: Blob; filename: string }>()
  const createId = deps.createId ?? (() => crypto.randomUUID())

  const emit = () => {
    if (attached) deps.onChange?.(items)
  }

  const commit = (event: Parameters<typeof reduceExportQueue>[1]) => {
    items = reduceExportQueue(items, event)
    emit()
  }

  const pump = () => {
    if (runningId) return
    const id = nextQueuedExportId(items)
    if (id) begin(id)
  }

  const begin = (id: string) => {
    const job = stored.get(id)
    if (!job || runningId) return
    runningId = id
    commit({ type: 'start', id })
    const controller = new AbortController()
    abort = controller
    let rendered: ReturnType<typeof deps.render>
    try {
      rendered = deps.render({
        snapshot: job.snapshot,
        settings: job.settings,
        signal: controller.signal,
        onProgress: (progress) => {
          if (runningId !== id || canceled.has(id)) return
          commit({ type: 'progress', id, progress: progress.fraction })
        },
      })
    } catch (error) {
      rendered = Promise.reject(error)
    }
    void rendered
      .then((result) => {
        if (runningId === id) runningId = null
        if (canceled.has(id) || controller.signal.aborted) {
          commit({ type: 'cancel', id })
          pump()
          return
        }
        deps.downloadFile(result.blob, result.filename)
        files.set(id, { blob: result.blob, filename: result.filename })
        commit({ type: 'complete', id })
        pump()
      })
      .catch((error: unknown) => {
        if (runningId === id) runningId = null
        if (canceled.has(id) || controller.signal.aborted || isExportCanceled(error)) {
          commit({ type: 'cancel', id })
        } else {
          commit({ type: 'fail', id, message: reportExportError(error).message || 'Export failed.' })
        }
        pump()
      })
  }

  const push = (settings: ExportSettings) => {
    const snapshot = deps.snapshot()
    const id = createId()
    stored.set(id, { snapshot, settings })
    commit({
      type: 'enqueue',
      item: {
        id,
        label: `${settings.mode === 'audio' ? 'WAV' : 'MP4'} · ${QUALITY_PRESETS[settings.quality].label}`,
        filename: exportDownloadName(settings, snapshot.name),
        status: 'queued',
        progress: null,
        message: null,
      },
    })
    return id
  }

  return {
    get items() {
      return items
    },
    get running() {
      return items.some((item) => item.status === 'running' || item.status === 'queued')
    },
    attach() {
      attached = true
      emit()
    },
    /** Drop UI updates. Does not abort a render that already started. */
    detach() {
      attached = false
    },
    startNow(settings: ExportSettings) {
      if (runningId) return
      const id = push(settings)
      begin(id)
    },
    addToQueue(settings: ExportSettings) {
      push(settings)
    },
    cancel(id: string) {
      if (runningId === id) {
        canceled.add(id)
        abort?.abort()
        commit({ type: 'cancel', id })
        return
      }
      commit({ type: 'cancel', id })
    },
    retry(id: string) {
      commit({ type: 'retry', id })
      pump()
    },
    download(id: string) {
      const file = files.get(id)
      if (!file) return
      deps.downloadFile(file.blob, file.filename)
    },
  }
}

export type ExportSession = ReturnType<typeof createExportSession>
