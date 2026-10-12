import { useEffect, useId, useState } from 'react'
import { hasMedia } from '@/lib/media/opfs-media-store'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'
import { exportDurationMs } from './export-plan'
import { browserMp4Probe } from './export-capabilities'
import { reportExportError } from './export-log'
import {
  EXPORT_FRAME_RATES,
  QUALITY_PRESETS,
  defaultExportSettings,
  estimateOutputBytes,
  exportDownloadName,
  formatByteEstimate,
  formatExportClock,
  inspectExportReadiness,
  parseExportTime,
  qualityRates,
  resolutionChoices,
  type ExportQuality,
  type ExportSettings,
} from './export-settings'
import type { ExportController } from './use-export'
import type { ExportQueueItem } from './export-queue'

export function ExportDialog({
  onClose,
  queue,
}: {
  onClose: () => void
  queue: ExportController
}) {
  const titleId = useId()
  const nameId = useId()
  const document = useEditorStore((state) => state.document)
  const durationMs = exportDurationMs(document)
  const [settings, setSettings] = useState<ExportSettings>(() =>
    defaultExportSettings(document.canvas.aspectRatio, durationMs),
  )
  const [nameOverride, setNameOverride] = useState<string | null>(null)
  const [rangeMode, setRangeMode] = useState<'all' | 'custom'>('all')
  const [actionError, setActionError] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<{
    ready: boolean
    issues: { level: 'block' | 'warn'; message: string }[]
  }>({
    ready: false,
    issues: [{ level: 'block', message: 'Checking encoders and media…' }],
  })
  const fileBaseName = nameOverride ?? document.name
  const applied: ExportSettings = {
    ...settings,
    fileBaseName,
    rangeStartMs: rangeMode === 'all' ? 0 : settings.rangeStartMs,
    rangeEndMs: rangeMode === 'all' ? durationMs : settings.rangeEndMs,
  }
  const resolutions = resolutionChoices(document.canvas.aspectRatio)
  const estimate = formatByteEstimate(estimateOutputBytes(applied))
  const filename = exportDownloadName(applied, document.name)
  const extension = applied.mode === 'audio' ? 'wav' : 'mp4'
  const blocking = readiness.issues.filter((issue) => issue.level === 'block')
  const warnings = readiness.issues.filter((issue) => issue.level === 'warn')
  const checking = blocking.some((issue) => issue.message.startsWith('Checking'))
  const blockMessage = !fileBaseName.trim()
    ? 'Enter a file name.'
    : (blocking[0]?.message ?? null)
  const canExport = readiness.ready && fileBaseName.trim().length > 0
  const latestJob = queue.items.at(-1) ?? null

  useEffect(() => {
    let cancelCheck = false
    const current: ExportSettings = {
      ...settings,
      rangeStartMs: rangeMode === 'all' ? 0 : settings.rangeStartMs,
      rangeEndMs: rangeMode === 'all' ? durationMs : settings.rangeEndMs,
    }
    const preset = QUALITY_PRESETS[current.quality]
    const probe = browserMp4Probe({
      videoBitrate: preset.videoBitrate,
      audioBitrate: preset.audioBitrate,
    })
    void inspectExportReadiness({
      document,
      settings: current,
      probe,
      mediaAvailable: async (id) => Boolean(getObjectUrl(id)) || hasMedia(id),
    }).then((result) => {
      if (!cancelCheck) setReadiness(result)
    }).catch((error: unknown) => {
      if (cancelCheck) return
      setReadiness({
        ready: false,
        issues: [{ level: 'block', message: reportExportError(error).message || 'Export could not be checked.' }],
      })
    })
    return () => {
      cancelCheck = true
    }
  }, [document, settings, rangeMode, durationMs])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = (next: Partial<ExportSettings>) => setSettings((current) => ({ ...current, ...next }))

  const exportFile = () => {
    if (!canExport) return
    setActionError(null)
    try {
      queue.enqueue(applied)
    } catch (error) {
      setActionError(reportExportError(error).message || 'Export could not start.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-8"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[min(760px,100%)] w-full max-w-[520px] flex-col border border-white/15 bg-[#0b1016]"
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            exportFile()
          }}
        >
          <div className="min-h-0 flex-1 overflow-auto p-5">
            <h2 id={titleId} className="text-[22px] font-bold tracking-[-0.04em] text-[#f4f4f4]">
              Export
            </h2>
            <p className="mt-1 text-[13px] text-fb-muted">
              {applied.mode === 'video'
                ? 'MP4 with H.264 video and AAC audio.'
                : 'WAV, 16-bit stereo, 48 kHz.'}
            </p>

            <label htmlFor={nameId} className="app-label mt-5 block">
              File name
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id={nameId}
                value={fileBaseName}
                autoFocus
                onChange={(event) => setNameOverride(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                className="app-field h-11 min-w-0 flex-1 px-3.5"
              />
              <span className="shrink-0 text-[13px] font-medium text-fb-muted">.{extension}</span>
            </div>
            {!fileBaseName.trim() && (
              <p className="mt-2 text-[12px] text-fb-danger" role="alert">
                Enter a file name.
              </p>
            )}

            <p className="app-label mt-5">Format</p>
            <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Format">
              <Choice
                pressed={applied.mode === 'video'}
                title="Video"
                detail="MP4 · H.264 · AAC"
                onClick={() => patch({ mode: 'video' })}
              />
              <Choice
                pressed={applied.mode === 'audio'}
                title="Audio only"
                detail="WAV · 16-bit · 48 kHz"
                onClick={() => patch({ mode: 'audio' })}
              />
            </div>

            {applied.mode === 'video' && (
              <>
                <p className="app-label mt-5">Quality</p>
                <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Quality">
                  {(Object.entries(QUALITY_PRESETS) as [ExportQuality, (typeof QUALITY_PRESETS)[ExportQuality]][]).map(
                    ([id, preset]) => {
                      const rates = qualityRates(id)
                      return (
                        <Choice
                          key={id}
                          pressed={applied.quality === id}
                          title={preset.label}
                          detail={`${rates.video} · ${rates.audio}`}
                          onClick={() => patch({ quality: id })}
                        />
                      )
                    },
                  )}
                </div>

                <p className="app-label mt-5">Resolution</p>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Resolution">
                  {resolutions.map((choice) => (
                    <button
                      key={choice.label}
                      type="button"
                      aria-pressed={applied.width === choice.width && applied.height === choice.height}
                      onClick={() => patch({ width: choice.width, height: choice.height })}
                      className={chipClass(
                        applied.width === choice.width && applied.height === choice.height,
                      )}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>

                <p className="app-label mt-5">Frame rate</p>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Frame rate">
                  {EXPORT_FRAME_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      aria-pressed={applied.frameRate === rate}
                      onClick={() => patch({ frameRate: rate })}
                      className={chipClass(applied.frameRate === rate)}
                    >
                      {rate} fps
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="app-label mt-5">Range</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Range">
              <button
                type="button"
                aria-pressed={rangeMode === 'all'}
                onClick={() => setRangeMode('all')}
                className={chipClass(rangeMode === 'all')}
              >
                Whole timeline
              </button>
              <button
                type="button"
                aria-pressed={rangeMode === 'custom'}
                onClick={() => setRangeMode('custom')}
                className={chipClass(rangeMode === 'custom')}
              >
                Custom
              </button>
            </div>
            {rangeMode === 'custom' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <TimeField
                  label="Start"
                  ms={settings.rangeStartMs}
                  onCommit={(ms) => patch({ rangeStartMs: ms })}
                />
                <TimeField
                  label="End"
                  ms={settings.rangeEndMs}
                  onCommit={(ms) => patch({ rangeEndMs: ms })}
                />
              </div>
            )}
            <p className="mt-2 text-[12px] text-fb-muted">
              {rangeMode === 'custom'
                ? 'Type seconds, or minutes:seconds. Example: 1:05.0'
                : `Timeline length ${formatExportClock(durationMs)}.`}
            </p>

            <div className="mt-5 border border-white/10 bg-white/[0.03] px-3 py-3">
              <p className="text-[13px] font-medium text-fb-text">
                {formatExportClock(Math.max(0, applied.rangeEndMs - applied.rangeStartMs))} · {estimate}
              </p>
              <p className="mt-1 text-[12px] text-fb-muted">
                {filename}. The size is an estimate. The file downloads when encoding finishes.
              </p>
              {warnings.map((issue) => (
                <p key={issue.message} className="mt-2 text-[12px] text-amber-300">
                  {issue.message}
                </p>
              ))}
            </div>

            {queue.items.length > 0 && (
              <ul className="mt-4 space-y-2" aria-label="Exports">
                {queue.items.map((item) => (
                  <ExportRow
                    key={item.id}
                    item={item}
                    runningLabel={queue.label}
                    onDownload={() => queue.download(item.id)}
                    onRetry={() => queue.retry(item.id)}
                    onCancel={() => queue.cancel(item.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-white/10 px-5 py-4">
            <FooterStatus
              checking={checking}
              blocked={actionError ?? blockMessage}
              job={actionError ? null : latestJob}
              runningLabel={queue.label}
            />
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="app-btn-quiet mr-auto">
                Close
              </button>
              <button type="submit" className="app-btn" disabled={!canExport}>
                {queue.running ? 'Exporting…' : checking ? 'Checking…' : 'Export'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function FooterStatus({
  checking,
  blocked,
  job,
  runningLabel,
}: {
  checking: boolean
  blocked: string | null
  job: ExportQueueItem | null
  runningLabel: string
}) {
  if (blocked) {
    return (
      <p className={`mb-3 text-[12px] ${checking && !blocked.startsWith('Enter') ? 'text-fb-muted' : 'text-fb-danger'}`} role="alert">
        {blocked}
      </p>
    )
  }
  if (!job) return null
  const failed = job.status === 'failed'
  const text =
    job.status === 'running'
      ? `${job.filename} · ${runningLabel}`
      : job.status === 'queued'
        ? `${job.filename} · Waiting`
        : job.status === 'completed'
          ? `${job.filename} is ready.`
          : job.status === 'cancelled'
            ? `${job.filename} canceled.`
            : (job.message ?? 'Export failed.')
  const percent = job.status === 'running' && job.progress != null ? Math.round(job.progress * 100) : null
  return (
    <div className="mb-3">
      <p className={`text-[12px] ${failed ? 'text-fb-danger' : 'text-fb-muted'}`} role="status">
        {text}
      </p>
      {job.status === 'running' && (
        <div className="mt-2 h-1 bg-white/10" aria-hidden="true">
          <div className="h-full bg-fb-accent" style={{ width: `${percent ?? 8}%` }} />
        </div>
      )}
    </div>
  )
}

function Choice({
  pressed,
  title,
  detail,
  onClick,
}: {
  pressed: boolean
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`cursor-pointer rounded-md border px-3 py-2.5 text-left ${
        pressed
          ? 'border-fb-accent bg-fb-accent-soft'
          : 'border-fb-border bg-fb-surface hover:border-fb-border-strong'
      }`}
    >
      <span className="block text-[13px] font-medium text-fb-text">{title}</span>
      <span className="mt-0.5 block text-[11px] text-fb-muted">{detail}</span>
    </button>
  )
}

function chipClass(pressed: boolean): string {
  return `h-9 cursor-pointer rounded-md border px-3 text-[13px] font-medium ${
    pressed
      ? 'border-fb-accent bg-fb-accent-soft text-fb-text'
      : 'border-fb-border bg-fb-surface text-fb-muted hover:border-fb-border-strong hover:text-fb-text'
  }`
}

function TimeField({ label, ms, onCommit }: { label: string; ms: number; onCommit: (ms: number) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label htmlFor={id}>
      <span className="app-label block">{label}</span>
      <input
        id={id}
        value={draft ?? formatExportClock(ms)}
        inputMode="decimal"
        autoComplete="off"
        onFocus={() => setDraft(formatExportClock(ms))}
        onChange={(event) => {
          setDraft(event.target.value)
          const parsed = parseExportTime(event.target.value)
          if (parsed != null) onCommit(parsed)
        }}
        onBlur={() => setDraft(null)}
        className="app-field mt-2 h-11 px-3.5"
      />
    </label>
  )
}

function ExportRow({
  item,
  runningLabel,
  onDownload,
  onRetry,
  onCancel,
}: {
  item: ExportQueueItem
  runningLabel: string
  onDownload: () => void
  onRetry: () => void
  onCancel: () => void
}) {
  const status =
    item.status === 'running'
      ? runningLabel
      : item.status === 'queued'
        ? 'Waiting'
        : item.status === 'completed'
          ? 'Ready'
          : item.status === 'cancelled'
            ? 'Canceled'
            : (item.message ?? 'Export failed.')
  const percent = item.status === 'running' && item.progress != null ? Math.round(item.progress * 100) : null
  return (
    <li className="border border-white/10 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-fb-text">{item.filename}</p>
          <p className="text-[12px] text-fb-muted">{status}</p>
        </div>
        {item.status === 'completed' && (
          <button type="button" className="app-btn h-8 text-[12px]" onClick={onDownload}>
            Download
          </button>
        )}
        {(item.status === 'failed' || item.status === 'cancelled') && (
          <button type="button" className="app-btn-quiet h-8 text-[12px]" onClick={onRetry}>
            Retry
          </button>
        )}
        {(item.status === 'queued' || item.status === 'running') && (
          <button type="button" className="app-btn-quiet h-8 text-[12px]" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {item.status === 'running' && (
        <div className="mt-2 h-1 bg-white/10" aria-hidden="true">
          <div
            className="h-full bg-fb-accent"
            style={{ width: `${percent ?? 8}%` }}
          />
        </div>
      )}
    </li>
  )
}
