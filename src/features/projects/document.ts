import { createEmptyProject, deserializeProject } from '@/features/editor/project'
import type { CanvasAspectRatio, MediaSource, ProjectDocument } from '@/types/timeline'

const PROJECT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isProjectId(value: string): boolean {
  return PROJECT_UUID.test(value)
}

export type DurableProjectPayload = {
  version: 1
  document: ProjectDocument
}

/**
 * JSON stored in projects.document. Runtime availability is not durable:
 * a session object URL is never written, and `available` becomes `known`.
 */
export function durableProjectPayload(
  document: ProjectDocument,
): DurableProjectPayload {
  const restored = deserializeProject(
    JSON.stringify({ version: 1 as const, document }),
  )
  return {
    version: 1,
    document: {
      ...restored,
      mediaSources: restored.mediaSources.map(durableMediaSource),
    },
  }
}

function durableMediaSource(source: MediaSource): MediaSource {
  if (source.locator.kind === 'opfs') {
    return { ...source, availability: 'known' }
  }
  if (source.locator.kind === 'runtime' && source.availability === 'available') {
    return { ...source, availability: 'known' }
  }
  return source
}

export function readStoredProject(
  payload: unknown,
  projectId: string,
): ProjectDocument {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Stored project document is missing')
  }
  const document = deserializeProject(JSON.stringify(payload))
  if (document.id !== projectId) {
    throw new Error('Stored project id does not match this project')
  }
  return document
}

/** Runtime locators without bytes in this page are missing, not available. */
export function prepareLoadedDocument(
  document: ProjectDocument,
  hasRuntimeBytes: (mediaSourceId: string) => boolean,
): ProjectDocument {
  return {
    ...document,
    mediaSources: document.mediaSources.map((source) => {
      if (source.locator.kind !== 'runtime') return source
      if (hasRuntimeBytes(source.id)) {
        return { ...source, availability: 'available' }
      }
      return { ...source, availability: 'missing' }
    }),
  }
}

export function buildNewProjectRecord(args: {
  ownerId: string
  name?: string
  id?: string
  aspectRatio?: CanvasAspectRatio
}): {
  ownerId: string
  row: {
    id: string
    owner_id: string
    name: string
    document: DurableProjectPayload
  }
} {
  if (!isProjectId(args.ownerId)) {
    throw new Error('Owner id must be a user UUID')
  }
  const id = args.id ?? crypto.randomUUID()
  if (!isProjectId(id)) throw new Error('Project id must be a UUID')
  const name = (args.name ?? 'Untitled Project').trim()
  if (!name) throw new Error('Project name is required')
  const document = createEmptyProject(name, id, args.aspectRatio ?? '16:9')
  return {
    ownerId: args.ownerId,
    row: {
      id,
      owner_id: args.ownerId,
      name: document.name,
      document: durableProjectPayload(document),
    },
  }
}
