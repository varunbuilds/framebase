import { durableProjectPayload, isProjectId } from '@/features/projects/document'
import type { ProjectDocument } from '@/types/timeline'
import { openDirectoryPath, readJson, writeJson } from './directory-path'
import {
  WORKSPACE_VERSION,
  type WorkspaceDirectory,
  type WorkspaceFile,
} from './workspace-types'

const WORKSPACE_FILE = 'workspace.json'
const PROJECTS = 'projects'
const MEDIA = 'media'
const CACHE = 'cache'

export class WorkspaceFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceFormatError'
  }
}

/**
 * Opens a valid Framebase folder, or creates the workspace files inside an
 * unrelated folder the user just chose. Existing files in that folder stay.
 */
export async function openExistingWorkspace(
  root: WorkspaceDirectory,
): Promise<WorkspaceFile> {
  const existing = await readJson(root, WORKSPACE_FILE)
  if (existing == null) {
    throw new WorkspaceFormatError(
      'This folder is not a Framebase workspace. Choose the workspace folder again. Nothing was deleted.',
    )
  }
  const parsed = parseWorkspaceFile(existing)
  if (parsed.name !== root.name) {
    const next = { ...parsed, name: root.name }
    await writeJson(root, WORKSPACE_FILE, next)
    await ensureWorkspaceDirectories(root)
    return next
  }
  await ensureWorkspaceDirectories(root)
  return parsed
}

export async function openOrCreateWorkspace(
  root: WorkspaceDirectory,
): Promise<WorkspaceFile> {
  const existing = await readJson(root, WORKSPACE_FILE)
  if (existing != null) {
    return openExistingWorkspace(root)
  }
  const created: WorkspaceFile = {
    version: WORKSPACE_VERSION,
    id: crypto.randomUUID(),
    name: root.name,
    createdAt: new Date().toISOString(),
  }
  await ensureWorkspaceDirectories(root)
  await writeJson(root, WORKSPACE_FILE, created)
  return created
}

export function parseWorkspaceFile(value: unknown): WorkspaceFile {
  if (typeof value !== 'object' || value === null) {
    throw new WorkspaceFormatError('This folder has a workspace file Framebase cannot read.')
  }
  const record = value as Record<string, unknown>
  if (record.version !== WORKSPACE_VERSION) {
    throw new WorkspaceFormatError('This Framebase workspace is from a newer version.')
  }
  if (typeof record.id !== 'string' || !isWorkspaceId(record.id)) {
    throw new WorkspaceFormatError('This Framebase workspace is missing an id.')
  }
  if (typeof record.name !== 'string' || !record.name.trim()) {
    throw new WorkspaceFormatError('This Framebase workspace is missing a name.')
  }
  if (typeof record.createdAt !== 'string') {
    throw new WorkspaceFormatError('This Framebase workspace is missing a created date.')
  }
  return {
    version: WORKSPACE_VERSION,
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
  }
}

export async function ensureWorkspaceDirectories(root: WorkspaceDirectory): Promise<void> {
  await openDirectoryPath(root, [PROJECTS], true)
  await openDirectoryPath(root, [MEDIA], true)
  await openDirectoryPath(root, [CACHE], true)
}

export async function workspaceMediaDirectory(
  root: WorkspaceDirectory,
): Promise<WorkspaceDirectory> {
  const directory = await openDirectoryPath(root, [MEDIA], true)
  if (!directory) throw new Error('Could not open the workspace media folder.')
  return directory
}

export async function workspaceCacheDirectory(
  root: WorkspaceDirectory,
): Promise<WorkspaceDirectory> {
  const directory = await openDirectoryPath(root, [CACHE], true)
  if (!directory) throw new Error('Could not open the workspace cache folder.')
  return directory
}

/** Local mirror of the cloud ProjectDocument. Supabase remains authoritative. */
export async function writeProjectMirror(
  root: WorkspaceDirectory,
  document: ProjectDocument,
): Promise<void> {
  if (!isProjectId(document.id)) throw new Error('Invalid project id')
  const folder = await openDirectoryPath(root, [PROJECTS, document.id], true)
  if (!folder) throw new Error('Could not open the local project folder.')
  await writeJson(folder, 'project.json', durableProjectPayload(document))
}

/** Removes projects/<projectId> only. Source files and unrelated files stay. */
export async function removeProjectDirectory(
  root: WorkspaceDirectory,
  projectId: string,
): Promise<void> {
  if (!isProjectId(projectId)) throw new Error('Invalid project id')
  const projects = await root.openDirectory(PROJECTS, { create: false })
  if (!projects) return
  await projects.remove(projectId, { recursive: true })
}

function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}
