import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import { durableProjectPayload } from '@/features/projects/document'
import { hydrateDocumentMedia } from '@/lib/media/hydrate-project-media'
import { releaseProjectMedia } from '@/lib/media/release-project-media'
import { filmstripCacheKey } from '@/lib/media/derived-cache'
import { createMemoryMediaStore } from '@/lib/media/memory-media-store'
import type { MediaSource } from '@/types/timeline'
import { openDirectoryPath } from './directory-path'
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
  parseWorkspaceMarker,
  removeProjectDirectory,
  writeProjectMirror,
  WorkspaceFormatError,
} from './workspace-layout'
import { createWorkspaceCacheStore } from './workspace-cache-store'
import { createWorkspaceMediaStore } from './workspace-media-store'
import {
  getFilmstripCacheDir,
  getMediaSourceFile,
  getProjectFile,
  getProjectThumbnail,
  getWaveformCacheDir,
} from './workspace-paths'

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
    expect(names).toEqual([
      '.framebase-workspace.json',
      'README.md',
      'index.json',
      'media',
      'notes.txt',
      'projects',
    ])
    expect(created.name).toBe('Framebase')
    expect(created.schemaVersion).toBe(1)
    const marker = JSON.parse(await (await root.readFile('.framebase-workspace.json'))!.text())
    expect(marker).toEqual({
      schemaVersion: 1,
      workspaceId: created.id,
      createdAt: created.createdAt,
    })
    expect(marker).not.toHaveProperty('path')
    expect(await root.readFile('workspace.json')).toBeNull()
    const index = JSON.parse(await (await root.readFile('index.json'))!.text())
    expect(index.projects).toEqual([])
    expect(await (await root.readFile('README.md'))!.text()).toContain('local mirror')

    const again = await openOrCreateWorkspace(root)
    expect(again.id).toBe(created.id)
    expect(await (await root.readFile('notes.txt'))!.text()).toBe('keep me')
  })

  it('does not overwrite a workspace file it cannot read', async () => {
    const root = createMemoryDirectory('Framebase')
    await root.writeFile(
      '.framebase-workspace.json',
      new Blob([JSON.stringify({ schemaVersion: 99 })]),
    )
    await root.writeFile('notes.txt', new Blob(['keep me']))
    await expect(openOrCreateWorkspace(root)).rejects.toBeInstanceOf(WorkspaceFormatError)
    expect(await (await root.readFile('notes.txt'))!.text()).toBe('keep me')
  })

  it('rejects a legacy workspace file from a newer version without replacing it', async () => {
    const root = createMemoryDirectory('Framebase')
    await root.writeFile('workspace.json', new Blob([JSON.stringify({ version: 99 })]))
    await root.writeFile('notes.txt', new Blob(['keep me']))
    await expect(openOrCreateWorkspace(root)).rejects.toBeInstanceOf(WorkspaceFormatError)
    expect(await root.readFile('.framebase-workspace.json')).toBeNull()
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
    const cache = createWorkspaceCacheStore(root)
    const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    await cache.set('media_a', filmstripCacheKey(500), jpeg)
    expect((await cache.get('media_a', filmstripCacheKey(500)))?.size).toBe(jpeg.size)
    const mediaDir = await (await root.openDirectory('media'))!.openDirectory('media_a')
    const cacheDir = await mediaDir!.openDirectory('cache')
    expect(cacheDir).not.toBeNull()
    const filmstrip = await cacheDir!.openDirectory('filmstrip')
    const manifest = JSON.parse(await (await filmstrip!.readFile('meta.json'))!.text())
    expect(manifest.mediaId).toBe('media_a')
    expect(manifest.kind).toBe('filmstrip')
    expect(manifest.complete).toBe(false)
    await cache.deleteMedia('media_a')
    expect(await cache.get('media_a', filmstripCacheKey(500))).toBeNull()
    expect(await media.has('media_a')).toBe(true)
    expect(await mediaDir!.readFile('source.mp4')).not.toBeNull()

    cache.set = async () => {
      throw new Error('quota')
    }
    await expect(cache.set('media_a', filmstripCacheKey(800), jpeg)).rejects.toThrow('quota')
    expect(await media.has('media_a')).toBe(true)
  })

  it('removes one project folder and leaves media files in place', async () => {
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

    const names = (await root.list()).map((entry) => entry.name)
    expect(names).toContain('notes.txt')
    const projects = await root.openDirectory('projects')
    expect(await projects!.list()).toEqual([])
    expect(await media.has('media_a')).toBe(true)
    expect(await media.has('media_b')).toBe(true)
    expect(await (await root.readFile('notes.txt'))!.text()).toBe('keep me')
    const index = JSON.parse(await (await root.readFile('index.json'))!.text())
    expect(index.projects).toEqual([])
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
    const oldMedia = createWorkspaceMediaStore(first)
    expect(await oldMedia.has('media_a')).toBe(true)
    expect((await first.list()).map((entry) => entry.name)).toContain('.framebase-workspace.json')
  })

  it('does not put a path or directory handle in the saved project', async () => {
    const root = createMemoryDirectory('Framebase')
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source('media_a', 'local')]
    await writeProjectMirror(root, document)
    const projects = await root.openDirectory('projects')
    const folder = await projects!.openDirectory(PROJECT_ID)
    const json = await (await folder!.readFile('project.json'))!.text()
    const links = JSON.parse(await (await folder!.readFile('media-links.json'))!.text())
    const queue = JSON.parse(await (await folder!.readFile('render-queue.json'))!.text())
    const payload = durableProjectPayload(document)
    expect(json).not.toContain('/Users/')
    expect(json).not.toContain('FileSystemDirectoryHandle')
    expect(json).not.toContain('blob:')
    expect(json).not.toContain('filmstrip')
    expect(json).not.toContain('contentHash')
    expect(links.mediaIds).toEqual([{ id: 'media_a', addedAt: '2026-01-01T00:00:00.000Z' }])
    document.mediaSources = []
    await writeProjectMirror(root, document)
    const rewritten = JSON.parse(await (await folder!.readFile('media-links.json'))!.text())
    expect(rewritten.mediaIds).toEqual([])
    expect(await (await folder!.readFile('project.json'))!.text()).not.toContain('media_a')
    expect(queue).toEqual({ version: 1, isPaused: false, jobs: [] })
    const index = JSON.parse(await (await root.readFile('index.json'))!.text())
    expect(index.projects.map((item: { id: string }) => item.id)).toEqual([PROJECT_ID])
    expect(JSON.stringify(payload)).not.toContain('FileSystemDirectoryHandle')
    expect(payload.document.mediaSources[0]?.locator).toEqual({
      kind: 'local',
      key: 'media_a',
    })
    expect(JSON.stringify(payload)).not.toContain('availability')
  })

  it('keeps the original extension, metadata, and content hash on the media asset', async () => {
    const root = createMemoryDirectory('Framebase')
    await connectWorkspace(root)
    const file = new File([Uint8Array.from([1, 2, 3, 4])], 'for Chanel.mov', {
      type: 'video/quicktime',
    })
    const thumb = new Blob([Uint8Array.from([9])], { type: 'image/jpeg' })
    await boundWorkspaceMedia()!.save('media_a', file, {
      name: file.name,
      mimeType: file.type,
      fileSize: file.size,
      durationMs: 19156,
      width: 1440,
      height: 1080,
      hasVideo: true,
      hasAudio: true,
      thumbnail: thumb,
    })
    const asset = await (await root.openDirectory('media'))!.openDirectory('media_a')
    expect(await asset!.readFile('source')).toBeNull()
    expect((await asset!.readFile('source.mov'))!.size).toBe(4)
    expect((await asset!.readFile('thumbnail.jpg'))!.size).toBe(1)
    const metadata = JSON.parse(await (await asset!.readFile('metadata.json'))!.text())
    expect(metadata.fileName).toBe('for Chanel.mov')
    expect(metadata.extension).toBe('.mov')
    expect(metadata.fileSize).toBe(4)
    expect(metadata.durationMs).toBe(19156)
    expect(metadata.width).toBe(1440)
    expect(metadata.storageType).toBe('workspace')
    expect(metadata.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(metadata.videoCodec).toBeUndefined()

    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [{ ...source('media_a', 'local'), name: 'for Chanel.mov' }]
    await writeProjectMirror(root, document)
    const project = await (await root.openDirectory('projects'))!.openDirectory(PROJECT_ID)
    expect((await project!.readFile('thumbnail.jpg'))!.size).toBe(1)
    expect(getProjectThumbnail(PROJECT_ID)).toBe(`projects/${PROJECT_ID}/thumbnail.jpg`)
  })

  it('migrates an old workspace without deleting the original until the new file matches', async () => {
    const root = createMemoryDirectory('Framebase')
    const legacyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await root.writeFile(
      'workspace.json',
      new Blob([
        JSON.stringify({
          version: 1,
          id: legacyId,
          name: 'Framebase',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ]),
    )
    const asset = await (
      await (await root.openDirectory('media', { create: true }))!.openDirectory('media_a', {
        create: true,
      })
    )!
    const original = new Blob([Uint8Array.from([1, 2, 3])], { type: 'video/mp4' })
    await asset.writeFile('source', original)
    await asset.writeFile(
      'metadata.json',
      new Blob([JSON.stringify({ name: 'clip.mp4', mimeType: 'video/mp4' })]),
    )
    await asset.writeFile('source.mp4', new Blob([Uint8Array.from([9])], { type: 'video/mp4' }))
    const tile = await openDirectoryPath(root, [
      'cache',
      'media_a',
      'filmstrip',
      'v1',
      'h180-q86',
    ], true)
    expect(tile).not.toBeNull()
    await tile!.writeFile('500.jpg', new Blob([Uint8Array.from([7])], { type: 'image/jpeg' }))

    const opened = await openOrCreateWorkspace(root)
    expect(opened.id).toBe(legacyId)
    expect(await root.readFile('workspace.json')).not.toBeNull()
    expect(parseWorkspaceMarker(
      JSON.parse(await (await root.readFile('.framebase-workspace.json'))!.text()),
      'Framebase',
    ).id).toBe(legacyId)
    expect(await asset.readFile('source')).toBeNull()
    expect((await asset.readFile('source.mp4'))!.size).toBe(3)
    const metadata = JSON.parse(await (await asset.readFile('metadata.json'))!.text())
    expect(metadata.extension).toBe('.mp4')
    expect(metadata.fileSize).toBe(3)
    expect(metadata.contentHash).toMatch(/^[0-9a-f]{64}$/)
    const cache = await asset.openDirectory('cache')
    const frame = await openDirectoryPath(cache!, ['filmstrip', 'v1', 'h180-q86'], false)
    expect(frame).not.toBeNull()
    expect((await frame!.readFile('500.jpg'))!.size).toBe(1)
    expect(await root.openDirectory('cache')).toBeNull()

    const metadataText = await (await asset.readFile('metadata.json'))!.text()
    await openOrCreateWorkspace(root)
    expect((await asset.readFile('source.mp4'))!.size).toBe(3)
    expect(await (await asset.readFile('metadata.json'))!.text()).toBe(metadataText)
    expect(await asset.readFile('source')).toBeNull()
  })

  it('does not delete local media when another cloud project still references it', async () => {
    const root = createMemoryDirectory('Framebase')
    await connectWorkspace(root)
    const media = boundWorkspaceMedia()!
    await media.save('media_shared', new Blob([Uint8Array.from([1])]), {
      name: 'a.mp4',
      mimeType: 'video/mp4',
    })
    const first = createEmptyProject('One', PROJECT_ID)
    first.mediaSources = [source('media_shared', 'local')]
    await writeProjectMirror(root, first)
    await releaseProjectMedia(first, async () => 2)
    expect(await media.has('media_shared')).toBe(true)
    const projects = await root.openDirectory('projects')
    expect(await projects!.list()).toEqual([])

    await media.save('media_only', new Blob([Uint8Array.from([2])]), {
      name: 'b.mp4',
      mimeType: 'video/mp4',
    })
    const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const second = createEmptyProject('Two', secondId)
    second.mediaSources = [source('media_only', 'local')]
    second.mediaSources[0] = { ...second.mediaSources[0]!, id: 'media_only' }
    await writeProjectMirror(root, second)
    await releaseProjectMedia(second, async () => {
      throw new Error('offline')
    })
    expect(await media.has('media_only')).toBe(true)
    await releaseProjectMedia(
      { ...second, mediaSources: [{ ...source('media_only', 'local'), id: 'media_only' }] },
      async () => 0,
    )
    expect(await media.has('media_only')).toBe(false)
    expect(await media.has('media_shared')).toBe(true)
  })

  it('builds cache and project paths without scattering the layout', () => {
    expect(getMediaSourceFile('for Chanel.mov', 'video/quicktime')).toBe('source.mov')
    expect(getProjectFile(PROJECT_ID)).toBe(`projects/${PROJECT_ID}/project.json`)
    expect(getFilmstripCacheDir('media_a')).toBe('media/media_a/cache/filmstrip/v1/h180-q86')
    expect(getWaveformCacheDir('media_a', { peakCount: 16000 })).toBe(
      'media/media_a/cache/waveform/v1/peaks-16000.bin',
    )
  })
})
