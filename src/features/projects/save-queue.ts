import type { ProjectDocument } from '@/types/timeline'

export type SaveQueueEvent =
  | { type: 'saving' }
  | { type: 'saved' }
  | { type: 'error'; message: string }

/**
 * One write at a time. A newer document replaces anything not yet started,
 * and a write already in flight is always followed by the newest document.
 * An older request cannot finish after a newer one.
 */
export function createSaveQueue(
  write: (document: ProjectDocument) => Promise<void>,
  onEvent?: (event: SaveQueueEvent) => void,
) {
  let pending: ProjectDocument | null = null
  let running = false

  const pump = async (): Promise<void> => {
    if (running) return
    running = true
    onEvent?.({ type: 'saving' })
    try {
      while (pending) {
        const next = pending
        pending = null
        await write(next)
      }
      onEvent?.({ type: 'saved' })
    } catch (error) {
      onEvent?.({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not save project',
      })
    } finally {
      running = false
      if (pending) await pump()
    }
  }

  return {
    push(document: ProjectDocument) {
      pending = document
      void pump()
    },
  }
}
