import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/stores/editor-store'
import { downloadBlob, revokeDownloadUrl } from './export-download'
import { logExportError, reportExportError } from './export-log'
import {
  exportRunDisposition,
  nextQueuedExportId,
  reduceExportQueue,
  type ExportQueueEvent,
  type ExportQueueItem,
} from './export-queue'
import { exportFilename, exportPhaseLabel, snapshotProject } from './export-plan'
import { renderProjectExport } from './export-renderer'
import { QUALITY_PRESETS, type ExportSettings } from './export-settings'
import { isExportCanceled } from './export-types'

type StoredJob = {
  snapshot: ReturnType<typeof snapshotProject>
  settings: ExportSettings
}

export function useExport() {
  const [items, setItems] = useState<ExportQueueItem[]>([])
  const itemsRef = useRef(items)
  const stored = useRef(new Map<string, StoredJob>())
  const blobs = useRef(new Map<string, { blob: Blob; url: string }>())
  const abortRef = useRef<AbortController | null>(null)
  const runningId = useRef<string | null>(null)
  const canceledIds = useRef(new Set<string>())
  const disposed = useRef(false)

  const commit = (event: ExportQueueEvent) => {
    const next = reduceExportQueue(itemsRef.current, event)
    itemsRef.current = next
    if (!disposed.current) setItems(next)
  }

  const releaseBlob = (id: string) => {
    const file = blobs.current.get(id)
    if (!file) return
    revokeDownloadUrl(file.url)
    blobs.current.delete(id)
  }

  const settle = (
    id: string,
    outcome: 'success' | 'failure' | 'canceled',
    result?: { blob: Blob; filename: string },
    message?: string,
  ) => {
    if (runningId.current === id) runningId.current = null
    if (disposed.current) {
      releaseBlob(id)
      return
    }
    const disposition = exportRunDisposition(outcome, canceledIds.current.has(id))
    if (disposition === 'complete' && result) {
      const url = downloadBlob(result.blob, result.filename)
      blobs.current.set(id, { blob: result.blob, url })
      commit({ type: 'complete', id })
    } else if (disposition === 'fail') {
      releaseBlob(id)
      commit({ type: 'fail', id, message: message ?? 'Export failed.' })
    } else {
      releaseBlob(id)
      commit({ type: 'cancel', id })
    }
    pump()
  }

  const pump = () => {
    const id = nextQueuedExportId(itemsRef.current)
    if (!id || runningId.current || disposed.current) return
    const job = stored.current.get(id)
    if (!job) return
    runningId.current = id
    commit({ type: 'start', id })
    const controller = new AbortController()
    abortRef.current = controller
    void renderProjectExport({
      snapshot: job.snapshot,
      settings: job.settings,
      signal: controller.signal,
      onProgress: (progress) => {
        if (runningId.current !== id || canceledIds.current.has(id)) return
        commit({ type: 'progress', id, progress: progress.fraction })
      },
    })
      .then((result) => {
        const outcome = controller.signal.aborted ? 'canceled' : 'success'
        settle(id, outcome, result)
      })
      .catch((error: unknown) => {
        logExportError(error)
        if (isExportCanceled(error) || controller.signal.aborted) {
          settle(id, 'canceled')
          return
        }
        settle(id, 'failure', undefined, reportExportError(error).message)
      })
  }

  useEffect(() => {
    const blobStore = blobs.current
    const canceled = canceledIds.current
    return () => {
      disposed.current = true
      if (runningId.current) canceled.add(runningId.current)
      abortRef.current?.abort()
      for (const file of blobStore.values()) revokeDownloadUrl(file.url)
    }
  }, [])

  const enqueue = (settings: ExportSettings) => {
    const snapshot = snapshotProject(useEditorStore.getState().document)
    const id = crypto.randomUUID()
    stored.current.set(id, { snapshot, settings })
    const extension = settings.mode === 'audio' ? 'wav' : 'mp4'
    commit({
      type: 'enqueue',
      item: {
        id,
        label: `${settings.mode === 'audio' ? 'WAV' : 'MP4'} · ${QUALITY_PRESETS[settings.quality].label}`,
        filename: exportFilename(snapshot.name, extension),
        status: 'queued',
        progress: null,
        message: null,
      },
    })
    pump()
  }

  const cancel = (id: string) => {
    if (runningId.current === id) {
      canceledIds.current.add(id)
      abortRef.current?.abort()
      commit({ type: 'cancel', id })
      return
    }
    commit({ type: 'cancel', id })
  }

  const retry = (id: string) => {
    commit({ type: 'retry', id })
    pump()
  }

  const download = (id: string) => {
    const file = blobs.current.get(id)
    const item = itemsRef.current.find((entry) => entry.id === id)
    if (!file || !item) return
    const anchor = document.createElement('a')
    anchor.href = file.url
    anchor.download = item.filename
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }

  const running = items.some((item) => item.status === 'running' || item.status === 'queued')
  const active = items.find((item) => item.status === 'running')
  const label =
    active?.progress == null
      ? exportPhaseLabel('preparing', null)
      : exportPhaseLabel('rendering', active.progress)

  return { items, running, label, enqueue, cancel, retry, download }
}
