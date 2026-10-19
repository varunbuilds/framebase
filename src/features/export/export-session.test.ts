import { describe, expect, it } from 'vitest'
import type { ProjectDocument } from '@/types/timeline'
import { defaultExportSettings, type ExportSettings } from './export-settings'
import { createExportSession, exportClickResult, type ExportRenderRequest } from './export-session'

const project = {
  id: 'project_1',
  name: 'Cut',
  canvas: { aspectRatio: '16:9' },
  tracks: [],
  clips: [],
  mediaSources: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as ProjectDocument

function settings(mode: ExportSettings['mode']): ExportSettings {
  return { ...defaultExportSettings('16:9', 1_000), mode, fileBaseName: 'Cut' }
}

function sessionWith(render: (request: ExportRenderRequest) => Promise<{ blob: Blob; filename: string }>) {
  const downloads: { filename: string; size: number }[] = []
  const session = createExportSession({
    render,
    downloadFile: (blob, filename) => {
      downloads.push({ filename, size: blob.size })
    },
    snapshot: () => project,
    createId: (() => {
      let n = 0
      return () => `job_${++n}`
    })(),
  })
  return { session, downloads }
}

describe('export click', () => {
  it('starts a video export from the final button', () => {
    const result = exportClickResult({
      settings: settings('video'),
      readiness: { ready: true, issues: [] },
    })
    expect(result.type).toBe('start')
    if (result.type !== 'start') return
    const renders: ExportSettings['mode'][] = []
    const { session } = sessionWith(async (request) => {
      renders.push(request.settings.mode)
      return { blob: new Blob(['video']), filename: 'Cut.mp4' }
    })
    session.startNow(result.settings)
    expect(renders).toEqual(['video'])
    expect(session.items[0]?.status).toBe('running')
  })

  it('starts an audio-only export from the final button', () => {
    const result = exportClickResult({
      settings: settings('audio'),
      readiness: { ready: true, issues: [] },
    })
    expect(result.type).toBe('start')
    if (result.type !== 'start') return
    const renders: ExportSettings['mode'][] = []
    const { session } = sessionWith(async (request) => {
      renders.push(request.settings.mode)
      return { blob: new Blob(['audio']), filename: 'Cut.wav' }
    })
    session.startNow(result.settings)
    expect(renders).toEqual(['audio'])
  })

  it('shows a preflight reason and does not start', () => {
    const result = exportClickResult({
      settings: settings('video'),
      readiness: {
        ready: false,
        issues: [{ level: 'block', message: 'Missing media: interview.mp4.' }],
      },
    })
    expect(result.type).toBe('blocked')
    if (result.type !== 'blocked') return
    expect(result.message).toMatch(/interview\.mp4/)
    expect(result.message).toMatch(/Re-import/)
    const renders: string[] = []
    const { session } = sessionWith(async () => {
      renders.push('render')
      return { blob: new Blob(), filename: 'Cut.mp4' }
    })
    expect(renders).toEqual([])
    expect(session.items).toEqual([])
  })

  it('keeps a visible error and can retry', async () => {
    let attempts = 0
    const { session } = sessionWith(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Could not decode the clip.')
      return { blob: new Blob(['ok']), filename: 'Cut.mp4' }
    })
    session.startNow(settings('video'))
    await Promise.resolve()
    await Promise.resolve()
    expect(session.items[0]).toMatchObject({
      status: 'failed',
      message: 'Could not decode the clip.',
    })
    session.retry('job_1')
    await Promise.resolve()
    await Promise.resolve()
    expect(attempts).toBe(2)
    expect(session.items[0]?.status).toBe('completed')
  })

  it('downloads the file after a successful export', async () => {
    const { session, downloads } = sessionWith(async () => ({
      blob: new Blob(['mp4-bytes']),
      filename: 'Cut.mp4',
    }))
    session.startNow(settings('video'))
    await Promise.resolve()
    expect(downloads).toEqual([{ filename: 'Cut.mp4', size: new Blob(['mp4-bytes']).size }])
    expect(session.items[0]?.status).toBe('completed')
    session.download('job_1')
    expect(downloads).toHaveLength(2)
  })

  it('does not cancel a running export when the owner detaches', async () => {
    let finish: (result: { blob: Blob; filename: string }) => void = () => undefined
    const { session, downloads } = sessionWith(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    session.attach()
    session.detach()
    session.attach()
    session.startNow(settings('video'))
    session.detach()
    finish({ blob: new Blob(['done']), filename: 'Cut.mp4' })
    await Promise.resolve()
    expect(session.items[0]?.status).toBe('completed')
    expect(downloads).toHaveLength(1)
  })

  it('adds to the queue without starting until an export is already running', async () => {
    const renders: string[] = []
    let finish: (result: { blob: Blob; filename: string }) => void = () => undefined
    const { session } = sessionWith(
      (request) =>
        new Promise((resolve) => {
          renders.push(request.settings.fileBaseName ?? '')
          finish = resolve
        }),
    )
    session.addToQueue({ ...settings('video'), fileBaseName: 'Queued' })
    expect(renders).toEqual([])
    expect(session.items[0]?.status).toBe('queued')
    session.startNow({ ...settings('audio'), fileBaseName: 'Now' })
    expect(renders).toEqual(['Now'])
    expect(session.items.map((item) => item.status)).toEqual(['queued', 'running'])
    finish({ blob: new Blob(['a']), filename: 'Now.wav' })
    await Promise.resolve()
    await Promise.resolve()
    expect(renders).toEqual(['Now', 'Queued'])
  })
})
