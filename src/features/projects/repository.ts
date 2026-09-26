import { getSupabase } from '@/lib/supabase/client'
import type { CanvasAspectRatio, ProjectDocument } from '@/types/timeline'
import {
  buildNewProjectRecord,
  durableProjectPayload,
  readStoredProject,
  type DurableProjectPayload,
} from './document'

export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found')
    this.name = 'ProjectNotFoundError'
  }
}

export type ProjectSummary = {
  id: string
  name: string
  updatedAt: string
}

export type StoredProject = ProjectSummary & {
  document: ProjectDocument
}

type ProjectSummaryRow = {
  id: string
  name: string
  updated_at: string
}

type ProjectRow = ProjectSummaryRow & {
  document: DurableProjectPayload
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as ProjectSummaryRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
  }))
}

export async function createProject(
  ownerId: string,
  options: { name?: string; aspectRatio?: CanvasAspectRatio } = {},
): Promise<StoredProject> {
  const record = buildNewProjectRecord({
    ownerId,
    name: options.name,
    aspectRatio: options.aspectRatio,
  })
  const { data, error } = await getSupabase()
    .from('projects')
    .insert(record.row)
    .select('id, name, updated_at, document')
    .single()

  if (error) throw error
  const row = data as ProjectRow
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    document: readStoredProject(row.document, row.id),
  }
}

export async function fetchProject(projectId: string): Promise<StoredProject> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('id, name, updated_at, document')
    .eq('id', projectId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new ProjectNotFoundError()
  const row = data as ProjectRow
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    document: readStoredProject(row.document, row.id),
  }
}

export async function saveProjectDocument(document: ProjectDocument): Promise<void> {
  const payload = durableProjectPayload(document)
  const { data, error } = await getSupabase()
    .from('projects')
    .update({
      name: payload.document.name,
      document: payload,
    })
    .eq('id', document.id)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Project could not be saved')
  }
}

let latestProjectWrite: Promise<void> = Promise.resolve()

/**
 * One project write at a time. The document is read when the write starts,
 * so an earlier snapshot cannot replace a newer one.
 */
export function saveLatestProjectDocument(read: () => ProjectDocument): Promise<void> {
  const run = latestProjectWrite.then(() => saveProjectDocument(read()))
  latestProjectWrite = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * How many project rows contain this media id. Storage deletion uses the
 * count so a source listed by another project is not removed.
 */
export async function countProjectsWithMedia(mediaSourceId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .contains('document', {
      document: { mediaSources: [{ id: mediaSourceId }] },
    })

  if (error) throw error
  return count ?? 0
}

export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await getSupabase().from('projects').delete().eq('id', projectId)
  if (error) throw error
}
