import { useEffect, useState } from 'react'
import { projectContentEqual } from '@/features/editor/project'
import { useEditorStore } from '@/stores/editor-store'
import type { ProjectDocument } from '@/types/timeline'
import { mirrorCurrentProject } from '@/lib/workspace/workspace-manager'
import { saveLatestProjectDocument } from './repository'
import { createSaveQueue } from './save-queue'

const SAVE_DELAY_MS = 800

/**
 * Persists ProjectDocument only. Playback, selection, object URLs, filmstrips,
 * and waveforms never enter the saved JSON. Saves run one at a time.
 */
export function useProjectAutosave(projectId: string) {
  const document = useEditorStore((state) => state.document)
  const saveRequest = useEditorStore((state) => state.ui.saveRequest)
  const setSaveStatus = useEditorStore((state) => state.setSaveStatus)

  const [controller] = useState(() => {
    let latest: ProjectDocument | null = null
    let lastWritten: ProjectDocument | null = null
    let primed = false
    const queue = createSaveQueue(
      () => saveLatestProjectDocument(() => useEditorStore.getState().document),
      (event) => {
      if (event.type === 'saving') {
        setSaveStatus('saving', { saveError: null })
        return
      }
      if (event.type === 'saved') {
        if (latest) {
          lastWritten = latest
          void mirrorCurrentProject(latest).catch(() => undefined)
        }
        setSaveStatus('saved', {
          lastSavedAt: new Date().toISOString(),
          saveError: null,
        })
        return
      }
      setSaveStatus('error', { saveError: event.message })
    })
    return {
      queue,
      setLatest(next: ProjectDocument) {
        latest = next
      },
      noteWritten(next: ProjectDocument) {
        lastWritten = next
      },
      isWritten(next: ProjectDocument) {
        return lastWritten != null && projectContentEqual(next, lastWritten)
      },
      prime() {
        if (primed) return false
        primed = true
        return true
      },
    }
  })

  useEffect(() => {
    controller.setLatest(document)
  }, [controller, document])

  useEffect(() => {
    if (document.id !== projectId) return
    if (controller.prime()) {
      controller.noteWritten(document)
      return
    }
    if (controller.isWritten(document)) return

    const timer = window.setTimeout(() => {
      controller.queue.push(document)
    }, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [controller, document, projectId])

  useEffect(() => {
    if (saveRequest === 0) return
    const current = useEditorStore.getState().document
    if (current.id !== projectId) return
    controller.queue.push(current)
  }, [controller, projectId, saveRequest])

  useEffect(() => {
    return () => {
      const current = useEditorStore.getState().document
      if (current.id !== projectId) return
      if (controller.isWritten(current)) return
      controller.queue.push(current)
    }
  }, [controller, projectId])
}
