import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/stores/editor-store'
import { downloadBlob, revokeDownloadUrl } from './export-download'
import { logExport, logExportError, reportExportError } from './export-log'
import { exportPhaseLabel, reduceExportJob, snapshotProject } from './export-plan'
import { renderProjectExport } from './export-renderer'
import { isExportCanceled, type ExportJob } from './export-types'

export function useExport() {
  const [job, setJob] = useState<ExportJob>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (urlRef.current) revokeDownloadUrl(urlRef.current)
    }
  }, [])

  const running =
    job.status === 'preparing' ||
    job.status === 'rendering' ||
    job.status === 'finalizing'

  const start = () => {
    if (running) return
    if (urlRef.current) {
      revokeDownloadUrl(urlRef.current)
      urlRef.current = null
    }
    const snapshot = snapshotProject(useEditorStore.getState().document)
    logExport('Starting export', { projectId: snapshot.id, name: snapshot.name })
    const controller = new AbortController()
    const run = ++generation.current
    abortRef.current = controller
    setJob((current) => reduceExportJob(current, { type: 'start' }))

    void renderProjectExport({
      snapshot,
      signal: controller.signal,
      onProgress: (progress) => {
        if (run !== generation.current) return
        setJob((current) => reduceExportJob(current, { type: 'progress', progress }))
      },
    })
      .then((result) => {
        if (run !== generation.current || controller.signal.aborted) return
        const url = downloadBlob(result.blob, result.filename)
        urlRef.current = url
        setJob((current) =>
          reduceExportJob(current, { type: 'complete', filename: result.filename }),
        )
      })
      .catch((error: unknown) => {
        logExportError(error)
        if (run !== generation.current) return
        if (isExportCanceled(error) || controller.signal.aborted) {
          setJob((current) => reduceExportJob(current, { type: 'cancel' }))
          return
        }
        const report = reportExportError(error)
        setJob((current) =>
          reduceExportJob(current, {
            type: 'fail',
            message: report.message,
            detail: report.detail,
          }),
        )
      })
  }

  const cancel = () => {
    generation.current += 1
    abortRef.current?.abort()
    setJob((current) => reduceExportJob(current, { type: 'cancel' }))
  }

  const reset = () => {
    if (running) return
    if (urlRef.current) {
      revokeDownloadUrl(urlRef.current)
      urlRef.current = null
    }
    setJob({ status: 'idle' })
  }

  const downloadAgain = () => {
    if (job.status !== 'complete' || !urlRef.current) return
    const anchor = document.createElement('a')
    anchor.href = urlRef.current
    anchor.download = job.filename
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }

  const label =
    job.status === 'preparing'
      ? exportPhaseLabel('preparing', null)
      : job.status === 'rendering'
        ? exportPhaseLabel('rendering', job.percent / 100)
        : job.status === 'finalizing'
          ? exportPhaseLabel('finalizing', null)
          : null

  return { job, running, label, start, cancel, reset, downloadAgain }
}
