import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import type { MediaSource, ProjectDocument } from '@/types/timeline'
import {
  buildNewProjectRecord,
  durableProjectPayload,
  prepareLoadedDocument,
  readStoredProject,
} from './document'
import { createSaveQueue } from './save-queue'

const ownerId = '11111111-1111-4111-8111-111111111111'

function sampleDocument(): ProjectDocument {
  const document = createEmptyProject('Interview', '22222222-2222-4222-8222-222222222222')
  const source: MediaSource = {
    id: 'media_1',
    name: 'clip.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: true,
    durationMs: 4000,
    mimeType: 'video/mp4',
    locator: { kind: 'runtime' },
    availability: 'available',
    importedAt: '2026-01-01T00:00:00.000Z',
  }
  return { ...document, mediaSources: [source] }
}

describe('project documents for persistence', () => {
  it('creates an empty ProjectDocument with the supplied id', () => {
    const record = buildNewProjectRecord({ ownerId, name: 'Untitled Project' })
    expect(record.ownerId).toBe(ownerId)
    expect(record.row.owner_id).toBe(ownerId)
    expect(record.row.document.document.id).toBe(record.row.id)
    expect(record.row.document.version).toBe(1)
    expect(record.row.document.document.clips).toEqual([])
    expect(record.row.document.document.tracks).toHaveLength(2)
    expect(record.row.document.document.canvas).toEqual({ aspectRatio: '16:9' })
    expect(JSON.stringify(record.row.document)).not.toContain('owner_id')
    expect(JSON.stringify(record.row.document)).not.toContain('blob:')
  })

  it('stores the selected aspect ratio on the document', () => {
    const record = buildNewProjectRecord({
      ownerId,
      name: '  Vertical  ',
      aspectRatio: '9:16',
    })
    expect(record.row.name).toBe('Vertical')
    expect(record.row.document.document.canvas.aspectRatio).toBe('9:16')
    const loaded = readStoredProject(record.row.document, record.row.id)
    expect(loaded.canvas.aspectRatio).toBe('9:16')
  })

  it('omits local availability and drops non-document fields', () => {
    const document = sampleDocument()
    const withRuntime = {
      ...document,
      mediaSources: document.mediaSources.map((source) => ({
        ...source,
        objectUrl: 'blob:http://localhost/secret',
      })),
    }
    const payload = durableProjectPayload(withRuntime as ProjectDocument)
    expect(payload.document.mediaSources[0]).not.toHaveProperty('availability')
    expect(JSON.stringify(payload)).not.toContain('availability')
    expect(JSON.stringify(payload)).not.toContain('blob:')
    expect(JSON.stringify(payload)).not.toContain('objectUrl')
  })

  it('keeps an OPFS locator and does not store file bytes', () => {
    const document = sampleDocument()
    document.mediaSources = [
      {
        ...document.mediaSources[0]!,
        locator: { kind: 'opfs', key: 'media_1' },
        availability: 'available',
      },
    ]
    const payload = durableProjectPayload(document)
    const source = payload.document.mediaSources[0]
    expect(source?.locator).toEqual({ kind: 'opfs', key: 'media_1' })
    expect(source).not.toHaveProperty('availability')
    expect(JSON.stringify(payload)).not.toContain('availability')
    expect(JSON.stringify(payload)).not.toContain('blob:')
    expect(JSON.stringify(payload)).not.toContain('objectUrl')
  })

  it('keeps the OPFS locator when a session marked the file missing', () => {
    const document = sampleDocument()
    document.mediaSources = [
      {
        ...document.mediaSources[0]!,
        locator: { kind: 'opfs', key: 'media_1' },
        availability: 'missing',
      },
    ]
    const payload = durableProjectPayload(document)
    expect(payload.document.mediaSources[0]?.locator).toEqual({
      kind: 'opfs',
      key: 'media_1',
    })
    expect(JSON.stringify(payload)).not.toContain('availability')
    const loaded = readStoredProject(payload, document.id)
    const prepared = prepareLoadedDocument(loaded, () => false)
    expect(prepared.mediaSources[0]?.locator).toEqual({ kind: 'opfs', key: 'media_1' })
    expect(prepared.mediaSources[0]?.availability).toBe('known')
  })

  it('loads a valid stored document and rejects invalid ones', () => {
    const payload = durableProjectPayload(sampleDocument())
    const loaded = readStoredProject(payload, payload.document.id)
    expect(loaded.name).toBe('Interview')
    expect(JSON.stringify(payload)).not.toContain('availability')
    expect(loaded.mediaSources[0]?.availability).toBe('known')

    const prior = structuredClone(payload) as {
      document: { mediaSources: Array<Record<string, unknown>> }
    }
    prior.document.mediaSources[0]!.availability = 'available'
    const ignored = readStoredProject(prior, payload.document.id)
    expect(ignored.mediaSources[0]?.availability).toBe('known')

    expect(() => readStoredProject(payload, ownerId)).toThrow(/does not match/)
    expect(() => readStoredProject({ version: 1, document: { id: 'x' } }, 'x')).toThrow()
    expect(() =>
      readStoredProject({ version: 2, document: payload.document }, payload.document.id),
    ).toThrow(/version/)
  })

  it('marks runtime media missing when this page has no bytes', () => {
    const loaded = readStoredProject(
      durableProjectPayload(sampleDocument()),
      sampleDocument().id,
    )
    const prepared = prepareLoadedDocument(loaded, () => false)
    expect(prepared.mediaSources[0]?.availability).toBe('missing')

    const stillHere = prepareLoadedDocument(loaded, (id) => id === 'media_1')
    expect(stillHere.mediaSources[0]?.availability).toBe('available')
  })
})

describe('project save queue', () => {
  it('writes an in-flight document before a newer one', async () => {
    const written: string[] = []
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const queue = createSaveQueue(async (document) => {
      written.push(document.id)
      if (written.length === 1) await gate
    })

    const older = createEmptyProject('A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const newer = createEmptyProject('B', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    queue.push(older)
    await Promise.resolve()
    queue.push(newer)
    expect(written).toEqual([older.id])
    releaseFirst()
    await gate
    await Promise.resolve()
    await Promise.resolve()
    expect(written).toEqual([older.id, newer.id])
  })
})
