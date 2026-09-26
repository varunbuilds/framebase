import { countProjectsWithMedia, saveLatestProjectDocument } from '@/features/projects/repository'
import { useEditorStore } from '@/stores/editor-store'
import type { MediaSource, ProjectDocument, RemoteMediaReference } from '@/types/timeline'
import {
  cloudPathsForProjectDeletion,
  CloudMediaError,
  downloadRemoteSource,
  uploadVerifiedLocalSource,
} from './cloud-media'
import { clearCloudTransfer, getCloudTransfer, setCloudTransfer } from './cloud-transfer'
import { deleteMedia, getMedia, hasMedia, saveMedia } from './opfs-media-store'
import { getObjectUrl, setObjectUrl } from './object-urls'
import { shareMediaDownload } from './sync-project-media'
import { browserSourceStorage, readBrowserStorageSession } from './source-storage'
import { isWorkspaceReady } from '@/lib/workspace/workspace-manager'

const storage = browserSourceStorage()

function transferMessage(error: unknown, fallback: string): string {
  if (error instanceof CloudMediaError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/**
 * Starts after the media source is already in the project document.
 * Progress stays in memory. A failure does not remove the local file.
 */
export function beginCloudUpload(source: MediaSource): void {
  if (source.remote) return
  if (getCloudTransfer(source.id)?.phase === 'uploading') return
  setCloudTransfer(source.id, { phase: 'uploading', progress: 0, message: null })
  void runUpload(source)
}

async function runUpload(source: MediaSource): Promise<void> {
  try {
    const remote = await uploadVerifiedLocalSource({
      source,
      authenticated: async () => Boolean(await readBrowserStorageSession()),
      persistProject: () =>
        saveLatestProjectDocument(() => useEditorStore.getState().document),
      readLocal: async () => (await getMedia(source.id))?.blob ?? null,
      client: storage,
      onProgress: (ratio) => {
        setCloudTransfer(source.id, { phase: 'uploading', progress: ratio, message: null })
      },
    })
    useEditorStore.getState().attachRemoteMedia(source.id, remote)
    clearCloudTransfer(source.id)
    await saveLatestProjectDocument(() => useEditorStore.getState().document)
    useEditorStore.getState().requestSave()
  } catch (error) {
    if (useEditorStore.getState().document.mediaSources.some((item) => item.id === source.id && item.remote)) {
      clearCloudTransfer(source.id)
      useEditorStore.getState().requestSave()
      return
    }
    setCloudTransfer(source.id, {
      phase: 'error',
      progress: null,
      message: transferMessage(error, 'Upload failed. Local media is still available.'),
    })
  }
}

/** Manual retry. Project open syncs cloud media without this button. */
export function beginCloudDownload(source: MediaSource): void {
  if (!source.remote) return
  if (getObjectUrl(source.id)) return
  if (!isWorkspaceReady()) {
    setCloudTransfer(source.id, {
      phase: 'error',
      progress: null,
      message: 'Reconnect the workspace before downloading media.',
    })
    return
  }
  if (getCloudTransfer(source.id)?.phase === 'downloading') return
  setCloudTransfer(source.id, { phase: 'downloading', progress: null, message: null })
  void runDownload(source)
}

async function runDownload(source: MediaSource): Promise<void> {
  try {
    await downloadSharedSource(source)
    if (!getObjectUrl(source.id)) {
      const stored = await getMedia(localMediaKey(source))
      if (stored) setObjectUrl(source.id, URL.createObjectURL(stored.blob))
    }
    clearCloudTransfer(source.id)
  } catch (error) {
    setCloudTransfer(source.id, {
      phase: 'error',
      progress: null,
      message: transferMessage(error, 'Download failed.'),
    })
  }
}

/**
 * Deletes this project's cloud sources while the project row still exists,
 * so storage policies can still see the owner. Shared ids are skipped.
 */
export async function deleteProjectCloudMedia(document: ProjectDocument): Promise<void> {
  if (!document.mediaSources.some((source) => source.remote)) return
  if (!(await readBrowserStorageSession())) {
    throw new CloudMediaError('logged-out', 'Sign in to remove cloud media.')
  }
  const paths = await cloudPathsForProjectDeletion(document, countProjectsWithMedia)
  if (paths.length === 0) return
  await storage.remove(paths)
}

export type { RemoteMediaReference }

function localMediaKey(source: MediaSource): string {
  if (source.locator.kind === 'local' || source.locator.kind === 'opfs') {
    return source.locator.key
  }
  return source.id
}

/** Downloads one remote source into the workspace. Shares an in-flight download. */
export function downloadSharedSource(source: MediaSource): Promise<void> {
  if (!isWorkspaceReady()) {
    return Promise.reject(
      new CloudMediaError('failed', 'Reconnect the workspace before downloading media.'),
    )
  }
  return shareMediaDownload(source.id, async () => {
    await downloadRemoteSource({
      source,
      hasLocal: () => hasMedia(localMediaKey(source)),
      authenticated: async () => Boolean(await readBrowserStorageSession()),
      client: storage,
      writeLocal: (body) =>
        saveMedia(localMediaKey(source), body, {
          name: source.name,
          mimeType: source.mimeType,
        }),
      readLocal: async () => (await getMedia(localMediaKey(source)))?.blob ?? null,
      deleteLocal: () => deleteMedia(localMediaKey(source)),
    })
  })
}
