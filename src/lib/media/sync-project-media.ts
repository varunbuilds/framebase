import type { MediaSource, ProjectDocument } from '@/types/timeline'

export type ProjectMediaSyncItem = {
  mediaSourceId: string
  outcome: 'local' | 'downloaded' | 'unavailable' | 'failed'
}

export type ProjectMediaSyncReport = {
  /** The document passed in. Local availability is not written onto it. */
  document: ProjectDocument
  items: ProjectMediaSyncItem[]
}

const downloads = new Map<string, Promise<void>>()
const projectSyncs = new Map<string, Promise<ProjectMediaSyncReport>>()

export function clearProjectMediaSync(): void {
  downloads.clear()
  projectSyncs.clear()
}

function localKey(source: MediaSource): string {
  if (source.locator.kind === 'local' || source.locator.kind === 'opfs') {
    return source.locator.key
  }
  return source.id
}

/**
 * One in-flight download per media id. A second caller, including a Strict
 * Mode remount, waits on the same promise instead of fetching again.
 */
export function shareMediaDownload(
  mediaSourceId: string,
  start: () => Promise<void>,
): Promise<void> {
  const current = downloads.get(mediaSourceId)
  if (current) return current
  const job = start().finally(() => {
    if (downloads.get(mediaSourceId) === job) downloads.delete(mediaSourceId)
  })
  downloads.set(mediaSourceId, job)
  return job
}

/**
 * Fills the connected workspace with this project's remote sources.
 * A file already in the workspace is left alone. Other projects' media is
 * not considered. The returned document is the same object that was passed in.
 */
export async function syncProjectMedia(args: {
  document: ProjectDocument
  workspaceReady: boolean
  hasLocal: (mediaSourceId: string) => Promise<boolean>
  download: (source: MediaSource) => Promise<void>
  onProgress?: (done: number, total: number) => void
}): Promise<ProjectMediaSyncReport> {
  const sources = args.document.mediaSources
  const items: ProjectMediaSyncItem[] = []
  if (!args.workspaceReady) {
    return { document: args.document, items }
  }

  for (const [index, source] of sources.entries()) {
    const present = await args.hasLocal(localKey(source))
    if (present) {
      items.push({ mediaSourceId: source.id, outcome: 'local' })
    } else if (!source.remote) {
      items.push({ mediaSourceId: source.id, outcome: 'unavailable' })
    } else {
      try {
        await shareMediaDownload(source.id, () => args.download(source))
        items.push({ mediaSourceId: source.id, outcome: 'downloaded' })
      } catch {
        items.push({ mediaSourceId: source.id, outcome: 'failed' })
      }
    }
    args.onProgress?.(index + 1, sources.length)
  }

  return { document: args.document, items }
}

function syncKey(document: ProjectDocument): string {
  const media = document.mediaSources
    .map((source) => {
      const remote = source.remote?.storagePath ?? ''
      return `${source.id}:${remote}`
    })
    .sort()
    .join('|')
  return `${document.id}|${media}`
}

/** Shared across overlapping mounts of the same project. */
export function syncProjectMediaOnce(
  args: Parameters<typeof syncProjectMedia>[0],
): Promise<ProjectMediaSyncReport> {
  const key = syncKey(args.document)
  const existing = projectSyncs.get(key)
  if (existing) return existing
  const job = syncProjectMedia(args).finally(() => {
    if (projectSyncs.get(key) === job) projectSyncs.delete(key)
  })
  projectSyncs.set(key, job)
  return job
}

/**
 * Loads canonical project JSON after sync and hydration. A cancelled caller
 * does not commit. Availability changes from hydration are not the saved document.
 */
export async function commitPreparedProject(args: {
  isActive: () => boolean
  document: ProjectDocument
  prepare: () => Promise<void>
  commit: (document: ProjectDocument) => void
}): Promise<boolean> {
  await args.prepare()
  if (!args.isActive()) return false
  args.commit(args.document)
  return true
}

export function syncProgressLabel(done: number, total: number): string {
  return `Syncing media ${done} of ${total}…`
}
