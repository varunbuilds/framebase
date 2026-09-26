import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import { durableProjectPayload } from '@/features/projects/document'
import { hydrateDocumentMedia } from '@/lib/media/hydrate-project-media'
import { filmstripCacheKey } from '@/lib/media/derived-cache'
import { createMemoryMediaStore } from '@/lib/media/memory-media-store'
import type { MediaSource } from '@/types/timeline'
import { createMemoryDirectory } from './memory-directory'
import { createResolvingMediaStore } from './resolving-store'
import { boundWorkspaceMedia } from './store-binding'
import { copyLegacyOpfsMediaIntoWorkspace } from './workspace-migration'
import { readWorkspacePointer, writeWorkspacePointer } from './workspace-pointer'
import {
  connectWorkspace,
  releaseWorkspaceConnection,
} from './workspace-manager'
import {
  openOrCreateWorkspace,
  removeProjectDirectory,
  workspaceCacheDirectory,
  workspaceMediaDirectory,
  writeProjectMirror,
  WorkspaceFormatError,
} from './workspace-layout'
import { createWorkspaceCacheStore } from './workspace-cache-store'
import { createWorkspaceMediaStore } from './workspace-media-store'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function source(id: string, kind: MediaSource['locator']['kind']): MediaSource {
  return {
    id,
    name: 'clip.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: false,
    durationMs: 1000,
    mimeType: 'video/mp4',
    locator:
      kind === 'runtime'
        ? { kind: 'runtime' }
        : { kind, key: id },
    availability: 'known',
    importedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('local workspace', () => {
  afterEach(() => {
    releaseWorkspaceConnection()
  })

  it('creates the workspace structure and leaves unrelated files in place', async () => {
    const root = createMemoryDirectory('Framebase')
    await root.writeFile('notes.txt', new Blob(['keep me']))

    const created = await openOrCreateWorkspace(root)
    const names = (await root.list()).map((entry) => entry.name).sort()
    expect(names).toEqual(['cache', 'media', 'notes.txt', 'projects', 'workspace.json'])
    expect(created.name).toBe('Framebase')
    expect(created.version).toBe(1)
    expect(JSON.parse(await (await root.readFile('workspace.json'))!.text())).not.toHaveProperty(
      'path',
    )

    const again = await openOrCreateWorkspace(root)
    expect(again.id).toBe(created.id)
    expect(await (await root.readFile('notes.txt'))!.text()).toBe('keep me')
  })

  it('does not overwrite a workspace file it cannot read', async () => {
    const root = createMemoryDirectory('Framebase')
    await root.writeFile('workspace.json', new Blob([JSON.stringify({ version: 99 })]))
    await root.writeFile('notes.txt', new Blob(['keep me']))
    await expect(openOrCreateWorkspace(root)).rejects.toBeInstanceOf(WorkspaceFormatError)
    expect(await (await root.readFile('notes.txt'))!.text()).toBe('keep me')
  })

  it('stores only the folder name and workspace id in the reconnect pointer', () => {
    const storage = new Map<string, string>()
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    }
    writeWorkspacePointer(memory, { id: PROJECT_ID, name: 'Framebase' })
    const raw = [...storage.values()][0] ?? ''
    expect(raw).not.toContain('/Users/')
    expect(raw).not.toContain('handle')
    expect(readWorkspacePointer(memory)).toEqual({ id: PROJECT_ID, name: 'Framebase' })
  })

  it('copies imported bytes into the workspace without changing the original file', async () => {
    const root = createMemoryDirectory('Framebase')
    await connectWorkspace(root)
    const original = Uint8Array.from([9, 8, 7, 6])
    const file = new File([original], 'video.mp4', { type: 'video/mp4' })
    const media = boundWorkspaceMedia()
    expect(media).not.toBeNull()
    await media!.save('media_a', file, { name: file.name, mimeType: file.type })

    expect(new Uint8Array(await file.arrayBuffer())).toEqual(original)
    const stored = await media!.get('media_a')
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(original)
    expect(stored?.name).toBe('video.mp4')

    releaseWorkspaceConnection()
    await connectWorkspace(root)
    expect(await boundWorkspaceMedia()!.has('media_a')).toBe(true)
  })

  it('keeps a media source in the project when the local file is missing', async () => {
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source('media_gone', 'local')]
    const hydrated = await hydrateDocumentMedia(document, {
      store: createMemoryMediaStore(),
    })
    expect(hydrated.document.mediaSources.map((item) => item.id)).toEqual(['media_gone'])
    expect(hydrated.document.mediaSources[0]?.availability).toBe('missing')
    expect(hydrated.document.mediaSources[0]?.locator).toEqual({
      kind: 'local',
      key: 'media_gone',
    })
  })

  it('still opens legacy OPFS media and prefers a workspace copy when both exist', async () => {
    const legacy = createMemoryMediaStore()
    const workspace = createMemoryMediaStore()
    const legacyBytes = new Blob([Uint8Array.from([1])], { type: 'video/mp4' })
    const workspaceBytes = new Blob([Uint8Array.from([2, 2])], { type: 'video/mp4' })
    await legacy.save('media_old', legacyBytes, { name: 'old.mp4', mimeType: 'video/mp4' })
    await workspace.save('media_old', workspaceBytes, { name: 'old.mp4', mimeType: 'video/mp4' })
    let current: typeof workspace | null = workspace
    const resolving = createResolvingMediaStore({
      workspace: () => current,
      legacy,
      unavailableMessage: 'Choose a local workspace before importing media.',
    })
    expect((await resolving.get('media_old'))?.blob.size).toBe(2)
    current = null
    expect((await resolving.get('media_old'))?.blob.size).toBe(1)

    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source('media_old', 'opfs')]
    const hydrated = await hydrateDocumentMedia(document, { store: legacy })
    expect(hydrated.document.mediaSources[0]?.availability).toBe('available')
    expect(hydrated.document.mediaSources[0]?.locator.kind).toBe('opfs')
  })

  it('copies legacy OPFS bytes into the workspace and leaves the OPFS copy', async () => {
    const legacy = createMemoryMediaStore()
    const workspace = createMemoryMediaStore()
    await legacy.save('media_old', new Blob([Uint8Array.from([4, 5, 6])]), {
      name: 'old.mp4',
      mimeType: 'video/mp4',
    })
    const copied = await copyLegacyOpfsMediaIntoWorkspace(['media_old'], { legacy, workspace })
    expect(copied).toEqual(['media_old'])
    expect((await workspace.get('media_old'))?.blob.size).toBe(3)
    expect(await legacy.has('media_old')).toBe(true)
  })

  it('reads and deletes caches without removing source media when a cache write fails', async () => {
    const root = createMemoryDirectory('Framebase')
    await connectWorkspace(root)
    const media = boundWorkspaceMedia()!
    await media.save('media_a', new Blob([Uint8Array.from([1])]), {
      name: 'a.mp4',
      mimeType: 'video/mp4',
    })
    const cacheRoot = await workspaceCacheDirectory(root)
    const cache = createWorkspaceCacheStore(cacheRoot)
    const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    await cache.set('media_a', filmstripCacheKey(500), jpeg)
    expect((await cache.get('media_a', filmstripCacheKey(500)))?.size).toBe(jpeg.size)
    await cache.deleteMedia('media_a')
    expect(await cache.get('media_a', filmstripCacheKey(500))).toBeNull()
    expect(await media.has('media_a')).toBe(true)

    cache.set = async () => {
      throw new Error('quota')
    }
    await expect(cache.set('media_a', filmstripCacheKey(800), jpeg)).rejects.toThrow('quota')
    expect(await media.has('media_a')).toBe(true)
  })

  it('removes one project folder and its media, not unrelated workspace files', async () => {
    const root = createMemoryDirectory('Framebase')
    await root.writeFile('notes.txt', new Blob(['keep me']))
    await connectWorkspace(root)
    const media = boundWorkspaceMedia()!
    const metadata = { name: 'a.mp4', mimeType: 'video/mp4' }
    await media.save('media_a', new Blob([Uint8Array.from([1])]), metadata)
    await media.save('media_b', new Blob([Uint8Array.from([2])]), metadata)
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source('media_a', 'local')]
    await writeProjectMirror(root, document)

    await removeProjectDirectory(root, PROJECT_ID)
    await media.delete('media_a')
    const cache = createWorkspaceCacheStore(await workspaceCacheDirectory(root))
    await cache.deleteMedia('media_a')

    const names = (await root.list()).map((entry) => entry.name)
    expect(names).toContain('notes.txt')
    const projects = await root.openDirectory('projects')
    expect(await projects!.list()).toEqual([])
    expect(await media.has('media_a')).toBe(false)
    expect(await media.has('media_b')).toBe(true)
    expect(await (await root.readFile('notes.txt'))!.text()).toBe('keep me')
  })

  it('does not delete the previous workspace when a different folder is connected', async () => {
    const first = createMemoryDirectory('Old')
    const second = createMemoryDirectory('New')
    await connectWorkspace(first)
    await boundWorkspaceMedia()!.save('media_a', new Blob([Uint8Array.from([1])]), {
      name: 'a.mp4',
      mimeType: 'video/mp4',
    })
    await connectWorkspace(second)
    expect(await boundWorkspaceMedia()!.has('media_a')).toBe(false)
    const oldMedia = createWorkspaceMediaStore(await workspaceMediaDirectory(first))
    expect(await oldMedia.has('media_a')).toBe(true)
    expect((await first.list()).map((entry) => entry.name)).toContain('workspace.json')
  })

  it('does not put a path or directory handle in the saved project', async () => {
    const root = createMemoryDirectory('Framebase')
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source('media_a', 'local')]
    await writeProjectMirror(root, document)
    const projects = await root.openDirectory('projects')
    const folder = await projects!.openDirectory(PROJECT_ID)
    const json = await (await folder!.readFile('project.json'))!.text()
    const payload = durableProjectPayload(document)
    expect(json).not.toContain('/Users/')
    expect(json).not.toContain('FileSystemDirectoryHandle')
    expect(json).not.toContain('blob:')
    expect(json).not.toContain('filmstrip')
    expect(JSON.stringify(payload)).not.toContain('FileSystemDirectoryHandle')
    expect(payload.document.mediaSources[0]?.locator).toEqual({
      kind: 'local',
      key: 'media_a',
    })
    expect(payload.document.mediaSources[0]?.availability).toBe('known')
  })
})
