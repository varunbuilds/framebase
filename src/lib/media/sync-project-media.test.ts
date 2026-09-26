import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import { durableProjectPayload } from '@/features/projects/document'
import { describeCloudMedia, remoteReference } from '@/lib/media/cloud-media'
import {
  clearProjectMediaSync,
  commitPreparedProject,
  shareMediaDownload,
  syncProgressLabel,
  syncProjectMedia,
  syncProjectMediaOnce,
} from '@/lib/media/sync-project-media'
import type { MediaSource, ProjectDocument } from '@/types/timeline'
import editorSource from '../../pages/EditorPage.tsx?raw'
import autosaveSource from '../../features/projects/use-project-autosave.ts?raw'
import { releaseWorkspaceConnection } from '@/lib/workspace/workspace-manager'
import { useEditorStore } from '@/stores/editor-store'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function source(id: string, remote: boolean, availability: MediaSource['availability'] = 'known'): MediaSource {
  return {
    id,
    name: `${id}.mp4`,
    kind: 'video',
    hasVideo: true,
    hasAudio: false,
    durationMs: 1000,
    mimeType: 'video/mp4',
    locator: { kind: 'local', key: id },
    availability,
    importedAt: '2026-01-01T00:00:00.000Z',
    ...(remote ? { remote: remoteReference(id, 4, '2026-01-02T00:00:00.000Z') } : {}),
  }
}

function project(ids: Array<{ id: string; remote: boolean }>, projectId = PROJECT_ID): ProjectDocument {
  const document = createEmptyProject('Cut', projectId)
  document.mediaSources = ids.map((item) => source(item.id, item.remote))
  return document
}

afterEach(() => {
  clearProjectMediaSync()
})

describe('automatic shared media sync', () => {
  it('downloads cloud media that is missing from the workspace', async () => {
    const document = project([{ id: 'media_cloud', remote: true }])
    const local = new Set<string>()
    const report = await syncProjectMedia({
      document,
      workspaceReady: true,
      hasLocal: async (id) => local.has(id),
      download: async (item) => {
        local.add(item.id)
      },
    })
    expect(report.items).toEqual([{ mediaSourceId: 'media_cloud', outcome: 'downloaded' }])
    expect(local.has('media_cloud')).toBe(true)
    expect(report.document).toBe(document)
  })

  it('does not download a source the workspace already has', async () => {
    const document = project([{ id: 'media_local', remote: true }])
    let downloads = 0
    const report = await syncProjectMedia({
      document,
      workspaceReady: true,
      hasLocal: async () => true,
      download: async () => {
        downloads += 1
      },
    })
    expect(downloads).toBe(0)
    expect(report.items[0]?.outcome).toBe('local')
  })

  it('syncs each missing source in the opened project', async () => {
    const document = project([
      { id: 'media_a', remote: true },
      { id: 'media_b', remote: true },
    ])
    const progress: string[] = []
    const downloaded: string[] = []
    await syncProjectMedia({
      document,
      workspaceReady: true,
      hasLocal: async () => false,
      download: async (item) => {
        downloaded.push(item.id)
      },
      onProgress: (done, total) => {
        progress.push(syncProgressLabel(done, total))
      },
    })
    expect(downloaded).toEqual(['media_a', 'media_b'])
    expect(progress).toEqual(['Syncing media 1 of 2…', 'Syncing media 2 of 2…'])
  })

  it('opens the project when one download fails and exposes retry', async () => {
    const document = project([
      { id: 'media_bad', remote: true },
      { id: 'media_ok', remote: true },
    ])
    const report = await syncProjectMedia({
      document,
      workspaceReady: true,
      hasLocal: async () => false,
      download: async (item) => {
        if (item.id === 'media_bad') throw new Error('network')
      },
    })
    expect(report.items.map((item) => item.outcome)).toEqual(['failed', 'downloaded'])
    expect(report.document.mediaSources.map((item) => item.id)).toEqual(['media_bad', 'media_ok'])
    expect(report.document.mediaSources[0]?.remote?.storagePath).toBe('media/media_bad/source')
    expect(
      describeCloudMedia({
        local: false,
        remote: true,
        transfer: { phase: 'error', progress: null, message: 'Download failed.' },
      }).action,
    ).toBe('retry')
  })

  it('shares one in-flight download across duplicate requests', async () => {
    let starts = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = shareMediaDownload('media_shared', async () => {
      starts += 1
      await gate
    })
    const second = shareMediaDownload('media_shared', async () => {
      starts += 1
      await gate
    })
    expect(first).toBe(second)
    release()
    await first
    expect(starts).toBe(1)
  })

  it('does not download twice when the same project opens twice at once', async () => {
    const document = project([{ id: 'media_once', remote: true }])
    let starts = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const args = {
      document,
      workspaceReady: true,
      hasLocal: async () => starts > 0,
      download: async () => {
        starts += 1
        await gate
      },
    }
    const first = syncProjectMediaOnce(args)
    const second = syncProjectMediaOnce(args)
    expect(first).toBe(second)
    release()
    await first
    expect(starts).toBe(1)
  })

  it('does not let a cancelled open replace a successful result', async () => {
    const document = project([{ id: 'media_keep', remote: true }])
    let saved: ProjectDocument | null = null
    const missing = {
      ...document,
      mediaSources: document.mediaSources.map((item) => ({
        ...item,
        availability: 'missing' as const,
      })),
    }
    const ignored = await commitPreparedProject({
      isActive: () => false,
      document: missing,
      prepare: async () => undefined,
      commit: (next) => {
        saved = next
      },
    })
    expect(ignored).toBe(false)
    expect(saved).toBeNull()
    const committed = await commitPreparedProject({
      isActive: () => true,
      document,
      prepare: async () => undefined,
      commit: (next) => {
        saved = next
      },
    })
    expect(committed).toBe(true)
    expect(saved).toBe(document)
    expect(document.mediaSources[0]?.availability).toBe('known')
  })

  it('does not persist a transient missing availability', () => {
    const document = project([{ id: 'media_known', remote: true }])
    const missing = {
      ...document,
      mediaSources: [{ ...document.mediaSources[0]!, availability: 'missing' as const }],
    }
    const saved = durableProjectPayload(missing)
    expect(saved.document.mediaSources[0]).not.toHaveProperty('availability')
    expect(JSON.stringify(saved)).not.toContain('availability')
    expect(JSON.stringify(durableProjectPayload(document))).toBe(JSON.stringify(saved))
    expect(autosaveSource).toContain('durableProjectPayload')
    expect(editorSource).toContain('commitPreparedProject')
    expect(editorSource).not.toContain('loadDocument(hydrated')
  })

  it('keeps local availability out of the document and keeps cloud metadata in it', async () => {
    const document = project([{ id: 'media_cloud', remote: true }])
    const report = await syncProjectMedia({
      document,
      workspaceReady: true,
      hasLocal: async () => false,
      download: async () => undefined,
    })
    const json = JSON.stringify(report.document)
    expect(json).toContain('media/media_cloud/source')
    expect(json).not.toContain('downloading')
    expect(report.document.mediaSources[0]?.availability).toBe('known')
    expect(report.document).toBe(document)
  })

  it('does not download when the workspace is not connected', async () => {
    const document = project([{ id: 'media_cloud', remote: true }])
    let downloads = 0
    const report = await syncProjectMedia({
      document,
      workspaceReady: false,
      hasLocal: async () => false,
      download: async () => {
        downloads += 1
      },
    })
    expect(downloads).toBe(0)
    expect(report.items).toEqual([])
  })

  it('does not download another project’s media or delete this workspace on logout', async () => {
    const local = new Map<string, string>([['media_other_user', 'bytes']])
    const theirs = project([{ id: 'media_other_user', remote: true }], PROJECT_ID)
    const ours = project([{ id: 'media_ours', remote: true }], OTHER_PROJECT)
    const downloaded: string[] = []
    await syncProjectMedia({
      document: ours,
      workspaceReady: true,
      hasLocal: async (id) => local.has(id),
      download: async (item) => {
        downloaded.push(item.id)
        local.set(item.id, 'downloaded')
      },
    })
    expect(downloaded).toEqual(['media_ours'])
    expect(local.get('media_other_user')).toBe('bytes')
    expect(ours.mediaSources.map((item) => item.id)).toEqual(['media_ours'])
    expect(theirs.mediaSources.map((item) => item.id)).toEqual(['media_other_user'])
    useEditorStore.getState().endEditingSession()
    releaseWorkspaceConnection()
    expect(local.get('media_other_user')).toBe('bytes')
    expect(local.get('media_ours')).toBe('downloaded')
  })
})
