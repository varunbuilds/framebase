import { useEffect, useState } from 'react'
import { useEditorStore } from '@/stores/editor-store'
import { downloadBlob } from './export-download'
import { exportPhaseLabel, snapshotProject } from './export-plan'
import { renderProjectExport } from './export-renderer'
import { createExportSession } from './export-session'
import type { ExportQueueItem } from './export-queue'

export function useExport() {
  const [items, setItems] = useState<ExportQueueItem[]>([])
  const [session] = useState(() =>
    createExportSession({
      render: renderProjectExport,
      downloadFile: (blob, filename) => {
        downloadBlob(blob, filename)
      },
      snapshot: () => snapshotProject(useEditorStore.getState().document),
      onChange: (next) => setItems([...next]),
    }),
  )

  useEffect(() => {
    session.attach()
    return () => {
      session.detach()
    }
  }, [session])

  const active = items.find((item) => item.status === 'running')
  const label =
    active?.progress == null
      ? exportPhaseLabel('preparing', null)
      : exportPhaseLabel('rendering', active.progress)

  return {
    items,
    running: items.some((item) => item.status === 'running'),
    label,
    startNow: session.startNow,
    addToQueue: session.addToQueue,
    cancel: session.cancel,
    retry: session.retry,
    download: session.download,
  }
}

export type ExportController = ReturnType<typeof useExport>
