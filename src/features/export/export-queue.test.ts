import { describe, expect, it } from 'vitest'
import {
  exportRunDisposition,
  nextQueuedExportId,
  reduceExportQueue,
  runningExportId,
  type ExportQueueItem,
} from './export-queue'

function item(id: string, status: ExportQueueItem['status'] = 'queued'): ExportQueueItem {
  return { id, label: 'MP4', filename: 'Cut.mp4', status, progress: null, message: null }
}

describe('export queue', () => {
  it('runs one job at a time and can cancel, fail, and retry', () => {
    let items = reduceExportQueue([], { type: 'enqueue', item: item('a') })
    items = reduceExportQueue(items, { type: 'enqueue', item: item('b') })
    expect(nextQueuedExportId(items)).toBe('a')
    items = reduceExportQueue(items, { type: 'start', id: 'a' })
    expect(runningExportId(items)).toBe('a')
    expect(nextQueuedExportId(items)).toBeNull()
    items = reduceExportQueue(items, { type: 'progress', id: 'a', progress: 0.5 })
    items = reduceExportQueue(items, { type: 'complete', id: 'a' })
    expect(items[0]?.status).toBe('completed')
    expect(nextQueuedExportId(items)).toBe('b')
    items = reduceExportQueue(items, { type: 'start', id: 'b' })
    items = reduceExportQueue(items, { type: 'fail', id: 'b', message: 'Export failed.' })
    expect(items[1]).toMatchObject({ status: 'failed', message: 'Export failed.' })
    items = reduceExportQueue(items, { type: 'retry', id: 'b' })
    expect(items[1]?.status).toBe('queued')
    items = reduceExportQueue(items, { type: 'cancel', id: 'b' })
    expect(items[1]?.status).toBe('cancelled')
  })

  it('a failure or cancel frees the running slot for the next job', () => {
    let items = reduceExportQueue([], { type: 'enqueue', item: item('a') })
    items = reduceExportQueue(items, { type: 'enqueue', item: item('b') })
    items = reduceExportQueue(items, { type: 'start', id: 'a' })
    items = reduceExportQueue(items, { type: 'fail', id: 'a', message: 'Export failed.' })
    expect(runningExportId(items)).toBeNull()
    expect(nextQueuedExportId(items)).toBe('b')

    items = reduceExportQueue(items, { type: 'start', id: 'b' })
    items = reduceExportQueue(items, { type: 'cancel', id: 'b' })
    items = reduceExportQueue(items, { type: 'complete', id: 'b' })
    expect(items[1]?.status).toBe('cancelled')
    expect(runningExportId(items)).toBeNull()
  })

  it('keeps a canceled run canceled when encoding later succeeds', () => {
    expect(exportRunDisposition('success', true)).toBe('cancel')
    expect(exportRunDisposition('failure', true)).toBe('cancel')
    expect(exportRunDisposition('canceled', false)).toBe('cancel')
    expect(exportRunDisposition('failure', false)).toBe('fail')
    expect(exportRunDisposition('success', false)).toBe('complete')
  })
})
