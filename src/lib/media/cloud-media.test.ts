import { describe, expect, it } from 'vitest'
import migrationSql from '../../../supabase/migrations/20260926173100_source_media_storage.sql?raw'
import cloudMediaSource from './cloud-media.ts?raw'
import sourceStorageSource from './source-storage.ts?raw'
import workspaceMediaStoreSource from '../workspace/workspace-media-store.ts?raw'
import { createEmptyProject } from '@/features/editor/project'
import { durableProjectPayload, readStoredProject } from '@/features/projects/document'
import { createMemoryMediaStore } from '@/lib/media/memory-media-store'
import { hydrateDocumentMedia } from '@/lib/media/hydrate-project-media'
import { createMemoryDirectory } from '@/lib/workspace/memory-directory'
import { removeProjectDirectory } from '@/lib/workspace/workspace-layout'
import { createResolvingMediaStore } from '@/lib/workspace/resolving-store'
import { copyLegacyOpfsMediaIntoWorkspace } from '@/lib/workspace/workspace-migration'
import { useEditorStore } from '@/stores/editor-store'
import type { MediaSource } from '@/types/timeline'
import {
  cloudPathsForProjectDeletion,
  describeCloudMedia,
  downloadRemoteSource,
  remoteReference,
  uploadVerifiedLocalSource,
  type SourceStorageClient,
} from './cloud-media'
import { createSourceStorageClient, type StorageSession } from './source-storage'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function source(overrides: Partial<MediaSource> = {}): MediaSource {
  return {
    id: 'media_1',
    name: 'clip.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: false,
    durationMs: 1000,
    mimeType: 'video/mp4',
    locator: { kind: 'local', key: 'media_1' },
    availability: 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function client(upload: SourceStorageClient['upload']): SourceStorageClient {
  return {
    upload,
    download: async () => new Blob(),
    remove: async () => undefined,
  }
}

function guardedBlob(bytes: string): { blob: Blob; buffered: () => boolean } {
  const blob = new Blob([bytes], { type: 'video/mp4' })
  let used = false
  Object.defineProperty(blob, 'arrayBuffer', {
    configurable: true,
    value() {
      used = true
      return Promise.reject(new Error('buffered the whole source'))
    },
  })
  return { blob, buffered: () => used }
}

describe('shared cloud media', () => {
  it('keeps local availability and a remote reference independent', () => {
    const localOnly = source()
    const cloudOnly = source({
      availability: 'missing',
      remote: remoteReference('media_1', 12, '2026-01-02T00:00:00.000Z'),
    })
    expect(localOnly.remote).toBeUndefined()
    expect(describeCloudMedia({ local: true, remote: false, transfer: null })).toEqual({
      text: '✓ Local',
      action: 'upload',
    })
    expect(cloudOnly.locator.kind).toBe('local')
    expect(describeCloudMedia({ local: false, remote: true, transfer: null })).toEqual({
      text: '☁ Available in cloud',
      action: 'download',
    })
    expect(
      describeCloudMedia({ local: true, remote: true, transfer: null }).text,
    ).toBe('✓ Synced')
    expect(
      describeCloudMedia({
        local: true,
        remote: false,
        transfer: { phase: 'uploading', progress: 0.42, message: null },
      }).text,
    ).toBe('↑ Uploading 42%')
    expect(
      describeCloudMedia({ local: false, remote: false, transfer: null }).text,
    ).toBe('⚠ Media unavailable')
  })

  it('keeps an uploaded source usable when the cloud upload fails', async () => {
    const local = new Blob(['local-video'], { type: 'video/mp4' })
    let persisted = false
    let uploaded = false
    await expect(
      uploadVerifiedLocalSource({
        source: source(),
        readLocal: async () => local,
        authenticated: async () => true,
        persistProject: async () => {
          persisted = true
        },
        client: client(async () => {
          uploaded = true
          throw new Error('network down')
        }),
      }),
    ).rejects.toThrow('network down')
    expect(persisted).toBe(true)
    expect(uploaded).toBe(true)
    expect(await local.text()).toBe('local-video')
  })

  it('records remote metadata after a successful upload', async () => {
    const local = new Blob(['local-video'], { type: 'video/mp4' })
    const uploads: string[] = []
    const remote = await uploadVerifiedLocalSource({
      source: source(),
      readLocal: async () => local,
      authenticated: async () => true,
      persistProject: async () => undefined,
      uploadedAt: '2026-02-02T00:00:00.000Z',
      client: client(async ({ path, body }) => {
        uploads.push(path)
        expect(body).toBe(local)
      }),
    })
    expect(uploads).toEqual(['media/media_1/source'])
    expect(remote).toEqual({
      assetId: 'media_1',
      storagePath: 'media/media_1/source',
      sizeBytes: local.size,
      uploadedAt: '2026-02-02T00:00:00.000Z',
    })
  })

  it('writes a downloaded source into the workspace and skips a local copy', async () => {
    const remote = remoteReference('media_1', 4, '2026-02-02T00:00:00.000Z')
    const body = new Blob(['1234'])
    let downloads = 0
    const written: Blob[] = []
    const result = await downloadRemoteSource({
      source: source({ availability: 'missing', remote }),
      hasLocal: async () => false,
      authenticated: async () => true,
      client: {
        upload: async () => undefined,
        remove: async () => undefined,
        download: async (path) => {
          downloads += 1
          expect(path).toBe('media/media_1/source')
          return body
        },
      },
      writeLocal: async (file) => {
        written.push(file)
      },
      readLocal: async () => body,
      deleteLocal: async () => undefined,
    })
    expect(result).toBe('downloaded')
    expect(written).toEqual([body])

    downloads = 0
    const skipped = await downloadRemoteSource({
      source: source({ remote }),
      hasLocal: async () => true,
      authenticated: async () => true,
      client: {
        upload: async () => undefined,
        remove: async () => undefined,
        download: async () => {
          downloads += 1
          return body
        },
      },
      writeLocal: async () => {
        throw new Error('should not write')
      },
      readLocal: async () => body,
      deleteLocal: async () => undefined,
    })
    expect(skipped).toBe('skipped')
    expect(downloads).toBe(0)
  })

  it('does not treat a failed download as a local source', async () => {
    const remote = remoteReference('media_1', 8, '2026-02-02T00:00:00.000Z')
    let writes = 0
    let deletes = 0
    await expect(
      downloadRemoteSource({
        source: source({ availability: 'missing', remote }),
        hasLocal: async () => false,
        authenticated: async () => true,
        client: {
          upload: async () => undefined,
          remove: async () => undefined,
          download: async () => new Blob(['short']),
        },
        writeLocal: async () => {
          writes += 1
        },
        readLocal: async () => null,
        deleteLocal: async () => {
          deletes += 1
        },
      }),
    ).rejects.toThrow('does not match')
    expect(writes).toBe(0)
    expect(deletes).toBe(0)

    await expect(
      downloadRemoteSource({
        source: source({ availability: 'missing', remote }),
        hasLocal: async () => false,
        authenticated: async () => true,
        client: {
          upload: async () => undefined,
          remove: async () => undefined,
          download: async () => new Blob(['12345678']),
        },
        writeLocal: async () => {
          writes += 1
        },
        readLocal: async () => new Blob(['1234']),
        deleteLocal: async () => {
          deletes += 1
        },
      }),
    ).rejects.toThrow('does not match')
    expect(writes).toBe(1)
    expect(deletes).toBeGreaterThan(0)
  })

  it('stores the remote reference without bytes, urls, or caches', () => {
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [
      {
        ...(source({
          remote: remoteReference('media_1', 4, '2026-02-02T00:00:00.000Z'),
        }) as MediaSource),
        objectUrl: 'blob:http://localhost/secret',
        filmstrip: 'cache/media_1/filmstrip/frame.jpg',
      } as unknown as MediaSource,
    ]
    const payload = durableProjectPayload(document)
    const json = JSON.stringify(payload)
    expect(json).not.toContain('blob:')
    expect(json).not.toContain('objectUrl')
    expect(json).not.toContain('filmstrip')
    expect(json).not.toContain('waveform')
    expect(json).toContain('media/media_1/source')
    expect(payload.document.mediaSources[0]?.remote?.sizeBytes).toBe(4)
    const reloaded = readStoredProject(payload, PROJECT_ID)
    expect(reloaded.mediaSources[0]?.remote?.storagePath).toBe('media/media_1/source')
  })

  it('keeps a project without cloud media unchanged', () => {
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source()]
    const payload = durableProjectPayload(document)
    const loaded = readStoredProject(payload, PROJECT_ID)
    expect(loaded.mediaSources[0]?.remote).toBeUndefined()
    expect(loaded.mediaSources[0]?.locator).toEqual({ kind: 'local', key: 'media_1' })
    expect(loaded.mediaSources[0]?.name).toBe('clip.mp4')
  })

  it('uploads a legacy OPFS source under the same id and still reads the old copy', async () => {
    const legacy = createMemoryMediaStore()
    const workspace = createMemoryMediaStore()
    const bytes = new Blob(['legacy-bytes'], { type: 'video/mp4' })
    await legacy.save('media_legacy', bytes, { name: 'old.mp4', mimeType: 'video/mp4' })
    const copied = await copyLegacyOpfsMediaIntoWorkspace(['media_legacy'], {
      legacy,
      workspace,
    })
    expect(copied).toEqual(['media_legacy'])
    expect(await legacy.has('media_legacy')).toBe(true)

    const stored = await workspace.get('media_legacy')
    const remote = await uploadVerifiedLocalSource({
      source: source({
        id: 'media_legacy',
        locator: { kind: 'opfs', key: 'media_legacy' },
      }),
      readLocal: async () => stored?.blob ?? null,
      authenticated: async () => true,
      persistProject: async () => undefined,
      uploadedAt: '2026-03-03T00:00:00.000Z',
      client: client(async ({ path, body }) => {
        expect(path).toBe('media/media_legacy/source')
        expect(body).toBe(stored?.blob)
      }),
    })
    expect(remote.assetId).toBe('media_legacy')
    expect(await (await legacy.get('media_legacy'))?.blob.text()).toBe('legacy-bytes')
  })

  it('still falls back to legacy OPFS when the workspace copy is missing', async () => {
    const legacy = createMemoryMediaStore()
    const workspace = createMemoryMediaStore()
    await legacy.save('media_legacy', new Blob(['legacy']), {
      name: 'old.mp4',
      mimeType: 'video/mp4',
    })
    const store = createResolvingMediaStore({
      workspace: () => workspace,
      legacy,
      unavailableMessage: 'Choose a local workspace before importing media.',
    })
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [
      source({
        id: 'media_legacy',
        locator: { kind: 'opfs', key: 'media_legacy' },
        availability: 'known',
      }),
    ]
    const hydrated = await hydrateDocumentMedia(document, { store, attach: () => undefined })
    expect(hydrated.document.mediaSources[0]?.availability).toBe('available')
  })

  it('deletes only this project folder and unshared cloud media', async () => {
    const root = createMemoryDirectory('workspace')
    await root.writeFile('notes.txt', new Blob(['keep']))
    const projects = await root.openDirectory('projects', { create: true })
    await projects?.openDirectory(PROJECT_ID, { create: true })
    await projects?.openDirectory(OTHER_PROJECT, { create: true })
    const media = await root.openDirectory('media', { create: true })
    await (await media?.openDirectory('media_other', { create: true }))?.writeFile(
      'source',
      new Blob(['other']),
    )
    await removeProjectDirectory(root, PROJECT_ID)
    expect(await root.readFile('notes.txt')).not.toBeNull()
    expect((await projects?.list())?.map((entry) => entry.name)).toEqual([OTHER_PROJECT])
    expect(await media?.readFile('source')).toBeNull()
    const other = await media?.openDirectory('media_other')
    expect(await other?.readFile('source')).not.toBeNull()

    const shared = source({
      id: 'media_shared',
      remote: remoteReference('media_shared', 4, '2026-02-02T00:00:00.000Z'),
    })
    const owned = source({
      remote: remoteReference('media_1', 4, '2026-02-02T00:00:00.000Z'),
    })
    const paths = await cloudPathsForProjectDeletion(
      { mediaSources: [shared, owned] },
      async (id) => (id === 'media_shared' ? 2 : 1),
    )
    expect(paths).toEqual(['media/media_1/source'])
  })

  it('refuses cloud access when logged out and rejects private-object denials', async () => {
    const calls: string[] = []
    const loggedOut = createSourceStorageClient({
      readSession: async () => null,
      fetchImpl: async () => {
        calls.push('fetch')
        throw new Error('network')
      },
    })
    await expect(
      loggedOut.upload({ path: 'media/media_1/source', body: new Blob(['x']), contentType: 'video/mp4' }),
    ).rejects.toThrow('Sign in')
    await expect(loggedOut.download('media/media_1/source')).rejects.toThrow('Sign in')
    expect(calls).toEqual([])

    await expect(
      uploadVerifiedLocalSource({
        source: source(),
        readLocal: async () => new Blob(['x']),
        authenticated: async () => false,
        persistProject: async () => {
          throw new Error('should not save')
        },
        client: client(async () => {
          throw new Error('should not upload')
        }),
      }),
    ).rejects.toThrow('Sign in')

    const session: StorageSession = {
      accessToken: 'token',
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
    }
    const denied = createSourceStorageClient({
      readSession: async () => session,
      fetchImpl: async () => new Response('no', { status: 403 }),
    })
    await expect(denied.download('media/media_1/source')).rejects.toThrow('do not have access')
    await expect(
      denied.upload({
        path: 'cache/media_1/filmstrip/v1/frame.jpg',
        body: new Blob(['jpeg']),
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow('Only original source media')
    expect(migrationSql).toContain("'framebase-source-media', 'framebase-source-media', false")
    expect(migrationSql).toContain('security invoker')
    expect(migrationSql).toContain('can_access_project_media')
    expect(migrationSql).not.toMatch(/to anon/)
    expect(migrationSql).not.toMatch(/to public/)
  })

  it('does not buffer the original source into an ArrayBuffer', async () => {
    const { blob, buffered } = guardedBlob('abcdefgh')
    await uploadVerifiedLocalSource({
      source: source(),
      readLocal: async () => blob,
      authenticated: async () => true,
      persistProject: async () => undefined,
      client: client(async ({ body }) => {
        expect(body).toBe(blob)
      }),
    })
    expect(buffered()).toBe(false)
    expect(cloudMediaSource).not.toMatch(/arrayBuffer/)
    expect(sourceStorageSource).not.toMatch(/arrayBuffer/)
    expect(workspaceMediaStoreSource).not.toMatch(/arrayBuffer/)
  })

  it('adds remote metadata without creating an undo step', () => {
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source()]
    useEditorStore.getState().loadDocument(document, null)
    useEditorStore.getState().setProjectName('Renamed')
    const remote = remoteReference('media_1', 4, '2026-02-02T00:00:00.000Z')
    useEditorStore.getState().attachRemoteMedia('media_1', remote)
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(1)
    useEditorStore.temporal.getState().undo()
    const current = useEditorStore.getState().document
    expect(current.name).toBe('Cut')
    expect(current.mediaSources[0]?.remote).toEqual(remote)
  })
})
