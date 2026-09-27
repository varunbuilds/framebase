import { ExportFailure } from './export-types'

const PREFIX = '[Framebase Export]'

export type ExportErrorReport = {
  message: string
  name: string
  detail: string
}

export function logExport(step: string, detail?: Record<string, unknown>): void {
  if (detail) console.info(PREFIX, step, detail)
  else console.info(PREFIX, step)
}

export function logExportError(error: unknown): void {
  console.error(PREFIX, 'ERROR', error)
  console.error(PREFIX, 'Export failed', error)
}

/** Keep the original error's name, message, and cause. Stack stays in the console. */
export function reportExportError(error: unknown): ExportErrorReport {
  if (error instanceof ExportFailure) {
    return { message: error.message, name: error.name, detail: error.detail }
  }
  if (error instanceof Error) {
    const cause = causeText(error.cause)
    return {
      message: error.message || 'Export failed.',
      name: error.name || 'Error',
      detail: [error.name, error.message, cause].filter(Boolean).join('\n'),
    }
  }
  return { message: serializeUnknown(error), name: 'Unknown', detail: serializeUnknown(error) }
}

function causeText(cause: unknown): string {
  if (cause == null) return ''
  if (cause instanceof Error) {
    const nested = causeText(cause.cause)
    return [cause.name, cause.message, nested].filter(Boolean).join('\n')
  }
  return serializeUnknown(cause)
}

function serializeUnknown(value: unknown): string {
  if (typeof value === 'string') return value || 'Unknown export error.'
  try {
    const json = JSON.stringify(value)
    return json && json !== 'null' && json !== 'undefined' ? json : String(value)
  } catch {
    return String(value)
  }
}
