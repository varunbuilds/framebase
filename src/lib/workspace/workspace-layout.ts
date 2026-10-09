import { durableProjectPayload, isProjectId } from '@/features/projects/document'
import type { ProjectDocument } from '@/types/timeline'
import { copyDirectoryContents, openDirectoryPath, readJson, writeJson } from './directory-path'
import { hashBlobSha256, parseMediaMetadata, blobsMatch } from './media-record'
import { extensionForMedia, getMediaSourceFile } from './workspace-paths'
import {
  getMediaDir,
  getProjectDir,
  LEGACY_CACHE_DIRECTORY,
  LEGACY_WORKSPACE_MARKER_FILE,
  MEDIA_CACHE_DIRECTORY,
  MEDIA_DIRECTORY,
  MEDIA_METADATA_FILE,
  PROJECTS_DIRECTORY,
  splitWorkspacePath,
  WORKSPACE_INDEX_FILE,
  WORKSPACE_MARKER_FILE,
  WORKSPACE_README_FILE,
} from './workspace-paths'
import {
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceDirectory,
  type WorkspaceFile,
} from './workspace-types'

export class WorkspaceFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceFormatError'
  }
}

export class WorkspaceMigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceMigrationError'
  }
}

const README = `Framebase workspace
====================

This folder is a Framebase workspace. Framebase stores local media and a local copy of project data here. You chose this folder; Framebase does not hide it inside the browser.

Collaborative project state lives in Liveblocks. The files under projects/<id>/project.json are a local mirror of that state. Editing project.json does not change the shared project. The next save from the editor overwrites the mirror.

What is safe to edit
--------------------
- Nothing in this folder is required for you to edit by hand.
- You can move or rename the workspace folder, then reconnect it from Framebase.

What is regeneratable
---------------------
- media/<id>/cache/ — filmstrips and waveforms. Deleting a cache never corrupts a project.
- media/<id>/thumbnail.jpg and projects/<id>/thumbnail.jpg — cover images.
- index.json — a local list of project names. Supabase is the list of projects you belong to.
- projects/<id>/media-links.json — an index of media ids used by that project. project.json is the mirror of the document; media-links.json does not override it.
- projects/<id>/render-queue.json — a reserved local export queue. It is not a background renderer.

What must stay intact
---------------------
- media/<id>/source.<ext> — the original media bytes.
- .framebase-workspace.json — identifies this folder as a Framebase workspace.

Layout
------
- projects/<projectId>/ — local project mirror, media index, cover, reserved render queue
- media/<mediaId>/ — source file, metadata, thumbnail, and that asset's cache

Reconnect or move
-----------------
Move or copy the whole folder. In Framebase, choose the folder again or reconnect permission for it. Do not merge two workspaces by copying individual media ids unless you also keep the projects that reference them.
`

type WorkspaceIndex = {
  version: 1
  updatedAt: string
  projects: Array<{ id: string; name: string; updatedAt: string }>
}

type MediaLinkFile = {
  version: 1
  projectId: string
  updatedAt: string
  mediaIds: Array<{ id: string; addedAt: string }>
}

type RenderQueueFile = {
  version: 1
  isPaused: boolean
  jobs: unknown[]
}

/**
 * Opens a valid Framebase folder. Does not create one.
 * An old workspace.json is migrated to .framebase-workspace.json and left in place.
 */
export async function openExistingWorkspace(
  root: WorkspaceDirectory,
): Promise<WorkspaceFile> {
  const opened = await readWorkspaceIdentity(root)
  await ensureWorkspaceDirectories(root)
  await writeReadmeIfMissing(root)
  const failures = await migrateLegacyMediaLayout(root)
  await refreshWorkspaceIndex(root)
  if (failures.length > 0) {
    throw new WorkspaceMigrationError(
      `Some media could not be moved into the new workspace layout. The original files were left in place. ${failures.join(' ')}`,
    )
  }
  return opened
}

export async function openOrCreateWorkspace(
  root: WorkspaceDirectory,
): Promise<WorkspaceFile> {
  const marker = await readJson(root, WORKSPACE_MARKER_FILE)
  const legacy = await readJson(root, LEGACY_WORKSPACE_MARKER_FILE)
  if (marker == null && legacy == null) {
    const created: WorkspaceFile = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      name: root.name,
      createdAt: new Date().toISOString(),
    }
    await ensureWorkspaceDirectories(root)
    await writeMarker(root, created)
    await writeReadmeIfMissing(root)
    await writeIndex(root, { version: 1, updatedAt: created.createdAt, projects: [] })
    return created
  }
  return openExistingWorkspace(root)
}

export function parseWorkspaceMarker(value: unknown, folderName: string): WorkspaceFile {
  if (typeof value !== 'object' || value === null) {
    throw new WorkspaceFormatError('This folder has a workspace file Framebase cannot read.')
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceFormatError('This Framebase workspace is from a newer version.')
  }
  if (typeof record.workspaceId !== 'string' || !isWorkspaceId(record.workspaceId)) {
    throw new WorkspaceFormatError('This Framebase workspace is missing an id.')
  }
  if (typeof record.createdAt !== 'string') {
    throw new WorkspaceFormatError('This Framebase workspace is missing a created date.')
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: record.workspaceId,
    name: folderName,
    createdAt: record.createdAt,
  }
}

export function parseLegacyWorkspaceFile(value: unknown, folderName: string): WorkspaceFile {
  if (typeof value !== 'object' || value === null) {
    throw new WorkspaceFormatError('This folder has a workspace file Framebase cannot read.')
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1) {
    throw new WorkspaceFormatError('This Framebase workspace is from a newer version.')
  }
  if (typeof record.id !== 'string' || !isWorkspaceId(record.id)) {
    throw new WorkspaceFormatError('This Framebase workspace is missing an id.')
  }
  if (typeof record.createdAt !== 'string') {
    throw new WorkspaceFormatError('This Framebase workspace is missing a created date.')
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: record.id,
    name: typeof record.name === 'string' && record.name.trim() ? record.name : folderName,
    createdAt: record.createdAt,
  }
}

export async function ensureWorkspaceDirectories(root: WorkspaceDirectory): Promise<void> {
  await openDirectoryPath(root, [PROJECTS_DIRECTORY], true)
  await openDirectoryPath(root, [MEDIA_DIRECTORY], true)
}

export async function workspaceMediaDirectory(
  root: WorkspaceDirectory,
): Promise<WorkspaceDirectory> {
  const directory = await openDirectoryPath(root, [MEDIA_DIRECTORY], true)
  if (!directory) throw new Error('Could not open the workspace media folder.')
  return directory
}

/** Local mirror of the Liveblocks ProjectDocument. Liveblocks stays authoritative. */
export async function writeProjectMirror(
  root: WorkspaceDirectory,
  document: ProjectDocument,
): Promise<void> {
  if (!isProjectId(document.id)) throw new Error('Invalid project id')
  const folder = await openDirectoryPath(root, splitWorkspacePath(getProjectDir(document.id)), true)
  if (!folder) throw new Error('Could not open the local project folder.')
  await writeJson(folder, 'project.json', durableProjectPayload(document))
  await writeJson(folder, 'media-links.json', mediaLinks(document))
  if ((await folder.readFile('render-queue.json')) == null) {
    const queue: RenderQueueFile = { version: 1, isPaused: false, jobs: [] }
    await writeJson(folder, 'render-queue.json', queue)
  }
  await copyProjectThumbnail(root, document).catch(() => undefined)
  await upsertIndexProject(root, {
    id: document.id,
    name: document.name,
    updatedAt: document.updatedAt,
  })
}

/** Removes projects/<projectId> only. Media bytes are not ownership of this folder. */
export async function removeProjectDirectory(
  root: WorkspaceDirectory,
  projectId: string,
): Promise<void> {
  if (!isProjectId(projectId)) throw new Error('Invalid project id')
  const projects = await root.openDirectory(PROJECTS_DIRECTORY, { create: false })
  if (projects) await projects.remove(projectId, { recursive: true })
  await refreshWorkspaceIndex(root)
}

export async function unreferencedMediaIds(
  root: WorkspaceDirectory,
  projectId: string,
  mediaIds: string[],
): Promise<string[]> {
  const referenced = new Set<string>()
  const projects = await root.openDirectory(PROJECTS_DIRECTORY, { create: false })
  if (projects) {
    for (const entry of await projects.list()) {
      if (entry.kind !== 'directory' || entry.name === projectId) continue
      const folder = await projects.openDirectory(entry.name, { create: false })
      if (!folder) continue
      const payload = await readJson(folder, 'project.json')
      for (const id of mediaIdsInPayload(payload)) referenced.add(id)
    }
  }
  return mediaIds.filter((id) => !referenced.has(id))
}

async function readWorkspaceIdentity(root: WorkspaceDirectory): Promise<WorkspaceFile> {
  const marker = await readJson(root, WORKSPACE_MARKER_FILE)
  if (marker != null) return parseWorkspaceMarker(marker, root.name)
  const legacy = await readJson(root, LEGACY_WORKSPACE_MARKER_FILE)
  if (legacy == null) {
    throw new WorkspaceFormatError(
      'This folder is not a Framebase workspace. Choose the workspace folder again. Nothing was deleted.',
    )
  }
  const parsed = parseLegacyWorkspaceFile(legacy, root.name)
  await writeMarker(root, parsed)
  return { ...parsed, name: root.name }
}

async function writeMarker(root: WorkspaceDirectory, file: WorkspaceFile): Promise<void> {
  await writeJson(root, WORKSPACE_MARKER_FILE, {
    schemaVersion: file.schemaVersion,
    workspaceId: file.id,
    createdAt: file.createdAt,
  })
}

async function writeReadmeIfMissing(root: WorkspaceDirectory): Promise<void> {
  if (await root.readFile(WORKSPACE_README_FILE)) return
  await root.writeFile(WORKSPACE_README_FILE, new Blob([README], { type: 'text/markdown' }))
}

export type LocalProjectListing = {
  id: string
  name: string
  updatedAt: string
}

/** Projects whose project.json mirror is valid in this folder. Not the cloud list. */
export async function listWorkspaceProjects(
  root: WorkspaceDirectory,
): Promise<LocalProjectListing[]> {
  const folder = await root.openDirectory(PROJECTS_DIRECTORY, { create: false })
  if (!folder) return []
  const projects: LocalProjectListing[] = []
  for (const entry of await folder.list()) {
    if (entry.kind !== 'directory' || !isProjectId(entry.name)) continue
    const projectDir = await folder.openDirectory(entry.name, { create: false })
    if (!projectDir) continue
    const payload = await readJson(projectDir, 'project.json')
    if (typeof payload !== 'object' || payload === null) continue
    const document = (payload as { document?: { id?: unknown; name?: unknown; updatedAt?: unknown } })
      .document
    if (!document || document.id !== entry.name || typeof document.name !== 'string') continue
    projects.push({
      id: entry.name,
      name: document.name,
      updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : '',
    })
  }
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return projects
}

async function refreshWorkspaceIndex(root: WorkspaceDirectory): Promise<void> {
  const projects: WorkspaceIndex['projects'] = []
  const folder = await root.openDirectory(PROJECTS_DIRECTORY, { create: true })
  if (folder) {
    for (const entry of await folder.list()) {
      if (entry.kind !== 'directory' || !isProjectId(entry.name)) continue
      const projectDir = await folder.openDirectory(entry.name, { create: false })
      if (!projectDir) continue
      const payload = await readJson(projectDir, 'project.json')
      const document =
        payload && typeof payload === 'object'
          ? (payload as { document?: { name?: unknown; updatedAt?: unknown } }).document
          : undefined
      projects.push({
        id: entry.name,
        name: typeof document?.name === 'string' ? document.name : 'Untitled',
        updatedAt:
          typeof document?.updatedAt === 'string' ? document.updatedAt : new Date().toISOString(),
      })
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name))
  await writeIndex(root, { version: 1, updatedAt: new Date().toISOString(), projects })
}

async function upsertIndexProject(
  root: WorkspaceDirectory,
  project: { id: string; name: string; updatedAt: string },
): Promise<void> {
  const current = await readIndex(root)
  const projects = current.projects.filter((item) => item.id !== project.id)
  projects.push(project)
  projects.sort((a, b) => a.name.localeCompare(b.name))
  await writeIndex(root, { version: 1, updatedAt: new Date().toISOString(), projects })
}

async function readIndex(root: WorkspaceDirectory): Promise<WorkspaceIndex> {
  const parsed = await readJson(root, WORKSPACE_INDEX_FILE)
  if (typeof parsed !== 'object' || parsed === null) {
    return { version: 1, updatedAt: new Date().toISOString(), projects: [] }
  }
  const record = parsed as { projects?: unknown }
  const projects = Array.isArray(record.projects)
    ? record.projects.flatMap((item) => {
        if (typeof item !== 'object' || item === null) return []
        const row = item as { id?: unknown; name?: unknown; updatedAt?: unknown }
        if (typeof row.id !== 'string' || typeof row.name !== 'string') return []
        return [
          {
            id: row.id,
            name: row.name,
            updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
          },
        ]
      })
    : []
  return { version: 1, updatedAt: new Date().toISOString(), projects }
}

async function writeIndex(root: WorkspaceDirectory, index: WorkspaceIndex): Promise<void> {
  await writeJson(root, WORKSPACE_INDEX_FILE, index)
}

function mediaLinks(document: ProjectDocument): MediaLinkFile {
  return {
    version: 1,
    projectId: document.id,
    updatedAt: document.updatedAt,
    mediaIds: document.mediaSources.map((source) => ({
      id: source.id,
      addedAt: source.importedAt,
    })),
  }
}

async function copyProjectThumbnail(
  root: WorkspaceDirectory,
  document: ProjectDocument,
): Promise<void> {
  const video = document.mediaSources.find((source) => source.hasVideo)
  if (!video) return
  const mediaDir = await openDirectoryPath(root, splitWorkspacePath(getMediaDir(video.id)), false)
  if (!mediaDir) return
  const thumb = await mediaDir.readFile('thumbnail.jpg')
  if (!thumb || thumb.size === 0) return
  const projectDir = await openDirectoryPath(
    root,
    splitWorkspacePath(getProjectDir(document.id)),
    true,
  )
  if (!projectDir) return
  await projectDir.writeFile('thumbnail.jpg', thumb)
}

/**
 * Moves extensionless source files and top-level caches into media/<id>/.
 * A failed asset keeps its old files. Successful assets are removed only
 * after the new bytes are the same size.
 */
export async function migrateLegacyMediaLayout(root: WorkspaceDirectory): Promise<string[]> {
  const failures: string[] = []
  const mediaRoot = await root.openDirectory(MEDIA_DIRECTORY, { create: false })
  const legacyCache = await root.openDirectory(LEGACY_CACHE_DIRECTORY, { create: false })
  if (!mediaRoot) return failures

  for (const entry of await mediaRoot.list()) {
    if (entry.kind !== 'directory') continue
    try {
      const directory = await mediaRoot.openDirectory(entry.name, { create: false })
      if (!directory) continue
      await migrateMediaDirectory(directory, entry.name, legacyCache)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown migration error'
      failures.push(`${entry.name}: ${message}`)
    }
  }

  if (legacyCache) {
    const leftover = await legacyCache.list()
    if (leftover.length === 0) {
      await root.remove(LEGACY_CACHE_DIRECTORY, { recursive: true })
    }
  }
  return failures
}

async function migrateMediaDirectory(
  directory: WorkspaceDirectory,
  mediaId: string,
  legacyCache: WorkspaceDirectory | null,
): Promise<void> {
  const legacySource = await directory.readFile('source')
  if (legacySource) {
    const metadata = parseMediaMetadata(await readJson(directory, MEDIA_METADATA_FILE), mediaId)
    const fileName = metadata?.fileName || 'media'
    const mimeType = metadata?.mimeType || legacySource.type || 'application/octet-stream'
    const sourceName = getMediaSourceFile(fileName, mimeType)
    const current = await directory.readFile(sourceName)
    const alreadyMatches = current != null && (await blobsMatch(current, legacySource))
    if (!alreadyMatches) {
      await directory.writeFile(sourceName, legacySource)
      const written = await directory.readFile(sourceName)
      if (!written || !(await blobsMatch(written, legacySource))) {
        throw new Error('The renamed source did not match the original bytes.')
      }
    }
    await directory.remove('source')
    if (await directory.readFile('source')) {
      throw new Error('The old extensionless source could not be removed.')
    }
  }

  if (legacyCache) {
    const oldCache = await legacyCache.openDirectory(mediaId, { create: false })
    if (oldCache) {
      const nextCache = await directory.openDirectory(MEDIA_CACHE_DIRECTORY, { create: true })
      if (!nextCache) throw new Error('Could not create the media cache folder.')
      await copyDirectoryContents(oldCache, nextCache)
      await legacyCache.remove(mediaId, { recursive: true })
    }
  }

  await expandStoredMetadata(directory, mediaId)
}

async function expandStoredMetadata(
  directory: WorkspaceDirectory,
  mediaId: string,
): Promise<void> {
  const existing = parseMediaMetadata(await readJson(directory, MEDIA_METADATA_FILE), mediaId)
  if (!existing) return
  const source = await findSourceBlob(directory)
  if (!source) return
  const extension = source.name.startsWith('source.')
    ? source.name.slice('source'.length)
    : existing.extension || extensionForMedia(existing.fileName, existing.mimeType)
  const contentHash =
    existing.contentHash ?? (await hashBlobSha256(source.blob))
  if (
    existing.extension === extension &&
    existing.fileSize === source.blob.size &&
    existing.id === mediaId &&
    existing.contentHash === contentHash
  ) {
    return
  }
  await writeJson(directory, MEDIA_METADATA_FILE, {
    ...existing,
    id: mediaId,
    storageType: 'workspace',
    extension,
    fileSize: source.blob.size || existing.fileSize,
    ...(contentHash ? { contentHash } : {}),
    updatedAt: new Date().toISOString(),
  })
}

async function findSourceBlob(
  directory: WorkspaceDirectory,
): Promise<{ name: string; blob: Blob } | null> {
  const entries = await directory.list()
  const named = entries.find(
    (entry) => entry.kind === 'file' && /^source\.[A-Za-z0-9]+$/.test(entry.name),
  )
  if (named) {
    const blob = await directory.readFile(named.name)
    if (blob) return { name: named.name, blob }
  }
  const legacy = await directory.readFile('source')
  if (legacy) return { name: 'source', blob: legacy }
  return null
}

function mediaIdsInPayload(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return []
  const sources = (value as { document?: { mediaSources?: Array<{ id?: unknown }> } }).document
    ?.mediaSources
  if (!Array.isArray(sources)) return []
  return sources.flatMap((source) => (typeof source.id === 'string' ? [source.id] : []))
}

function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}
