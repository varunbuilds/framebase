import { createEmptyProject, deserializeProject } from '@/features/editor/project'
import type {
  CanvasAspectRatio,
  MediaSource,
  ProjectDocument,
} from '@/types/timeline'

const PROJECT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isProjectId(value: string): boolean {
  return PROJECT_UUID.test(value)
}

/** Media identity and cloud metadata. Local availability is not shared. */
export type DurableMediaSource = Omit<MediaSource, 'availability'>

export type DurableProjectDocument = Omit<ProjectDocument, 'mediaSources'> & {
  mediaSources: DurableMediaSource[]
}

export type DurableProjectPayload = {
  version: 1
  document: DurableProjectDocument
}

/**
 * JSON stored in projects.document.
 * Availability is this device's runtime state, so it is omitted.
 * Remote storage metadata is kept.
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

function durableMediaSource(source: MediaSource): DurableMediaSource {
  const shared: DurableMediaSource = {
    id: source.id,
    name: source.name,
    kind: source.kind,
    hasVideo: source.hasVideo,
    hasAudio: source.hasAudio,
    durationMs: source.durationMs,
    mimeType: source.mimeType,
    locator: { ...source.locator },
    importedAt: source.importedAt,
  }
  if (source.width != null) shared.width = source.width
  if (source.height != null) shared.height = source.height
  if (source.sampleRate != null) shared.sampleRate = source.sampleRate
  if (source.channelCount != null) shared.channelCount = source.channelCount
  if (source.remote) shared.remote = { ...source.remote }
  return shared
}

export function readStoredProject(
  payload: unknown,
  projectId: string,
): ProjectDocument {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Stored project document is missing')
  }
  const document = deserializeProject(JSON.stringify(withLocalAvailability(payload)))
  if (document.id !== projectId) {
    throw new Error('Stored project id does not match this project')
  }
  return document
}

/**
 * Stored JSON may include an older availability value, or none.
 * Either way this device assigns `known` until its own workspace resolves the file.
 */
function withLocalAvailability(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return payload
  const copy = JSON.parse(JSON.stringify(payload)) as {
    document?: { mediaSources?: Array<Record<string, unknown>> }
  }
  const sources = copy.document?.mediaSources
  if (!Array.isArray(sources)) return copy
  for (const source of sources) {
    if (typeof source === 'object' && source !== null) {
      source.availability = 'known'
    }
  }
  return copy
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
