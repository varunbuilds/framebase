import { useEffect, useId, useState, type ReactNode } from 'react'
import { hasMedia } from '@/lib/media/opfs-media-store'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'
import { exportDurationMs } from './export-plan'
import { browserMp4Probe } from './export-capabilities'
import {
  EXPORT_FRAME_RATES,
  QUALITY_PRESETS,
  UNSUPPORTED_EXPORT_OPTIONS,
  defaultExportSettings,
  estimateOutputBytes,
  formatByteEstimate,
  inspectExportReadiness,
  resolutionChoices,
  type ExportFrameRate,
  type ExportQuality,
  type ExportSettings,
} from './export-settings'
import { useExport } from './use-export'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const document = useEditorStore((state) => state.document)
  const durationMs = exportDurationMs(document)
  const [settings, setSettings] = useState<ExportSettings>(() =>
    defaultExportSettings(document.canvas.aspectRatio, durationMs),
  )
  const [readiness, setReadiness] = useState<{ ready: boolean; issues: { level: 'block' | 'warn'; message: string }[] }>({
    ready: false,
    issues: [{ level: 'block', message: 'Checking encoders and media…' }],
  })
  const { items, label, enqueue, cancel, retry, download } = useExport()
  const resolutions = resolutionChoices(document.canvas.aspectRatio)
  const estimate = formatByteEstimate(estimateOutputBytes(settings))

  useEffect(() => {
    let cancelCheck = false
    const preset = QUALITY_PRESETS[settings.quality]
    const probe = browserMp4Probe({
      videoBitrate: preset.videoBitrate,
      audioBitrate: preset.audioBitrate,
    })
    void inspectExportReadiness({
      document,
      settings,
      probe,
      mediaAvailable: async (id) => Boolean(getObjectUrl(id)) || hasMedia(id),
    }).then((result) => {
      if (!cancelCheck) setReadiness(result)
    })
    return () => {
      cancelCheck = true
    }
  }, [document, settings])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = (next: Partial<ExportSettings>) => setSettings((current) => ({ ...current, ...next }))

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[min(760px,100%)] w-full max-w-[560px] overflow-auto border border-white/15 bg-[#0b1016] p-5"
      >
        <h2 id={titleId} className="text-[22px] font-bold tracking-[-0.04em] text-[#f4f4f4]">
          Export
        </h2>

        <div className="mt-4 flex gap-2" role="group" aria-label="Export type">
          {(['video', 'audio'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={settings.mode === mode}
              onClick={() => patch({ mode })}
              className={`h-8 px-3 text-[13px] ${settings.mode === mode ? 'app-btn' : 'app-btn-quiet'}`}
            >
              {mode === 'video' ? 'Video' : 'Audio'}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 text-[13px]">
          {settings.mode === 'video' ? (
            <>
              <Field label="Container">
                <p className="font-medium text-fb-text">MP4 · H.264 · AAC</p>
              </Field>
              <Field label="Quality">
                <select
                  className="app-field"
                  value={settings.quality}
                  onChange={(event) => patch({ quality: event.target.value as ExportQuality })}
                >
                  {Object.entries(QUALITY_PRESETS).map(([id, preset]) => (
                    <option key={id} value={id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Resolution">
                <select
                  className="app-field"
                  value={`${settings.width}x${settings.height}`}
                  onChange={(event) => {
                    const choice = resolutions.find((item) => `${item.width}x${item.height}` === event.target.value)
                    if (choice) patch({ width: choice.width, height: choice.height })
                  }}
                >
                  {resolutions.map((choice) => (
                    <option key={choice.label} value={`${choice.width}x${choice.height}`}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Frame rate">
                <select
                  className="app-field"
                  value={settings.frameRate}
                  onChange={(event) => patch({ frameRate: Number(event.target.value) as ExportFrameRate })}
                >
                  {EXPORT_FRAME_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} fps
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <Field label="Format">
              <p className="font-medium text-fb-text">WAV · 16-bit PCM · 48 kHz stereo</p>
            </Field>
          )}

          <Field label="Range">
            <div className="flex items-center gap-2">
              <input
                className="app-field w-24"
                type="number"
                min={0}
                step={0.1}
                aria-label="Range start seconds"
                value={settings.rangeStartMs / 1000}
                onChange={(event) => patch({ rangeStartMs: Number(event.target.value) * 1000 })}
              />
              <span className="text-fb-muted">to</span>
              <input
                className="app-field w-24"
                type="number"
                min={0}
                step={0.1}
                aria-label="Range end seconds"
                value={settings.rangeEndMs / 1000}
                onChange={(event) => patch({ rangeEndMs: Number(event.target.value) * 1000 })}
              />
            </div>
          </Field>
        </div>

        <div className="mt-4 border border-white/10 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">Preflight</p>
          <ul className="mt-2 space-y-1 text-[12px]">
            {readiness.issues.length === 0 ? (
              <li className="text-emerald-400">Ready. Estimate {estimate}. Estimates are approximate.</li>
            ) : (
              readiness.issues.map((issue) => (
                <li key={issue.message} className={issue.level === 'block' ? 'text-fb-danger' : 'text-amber-300'}>
                  {issue.message}
                </li>
              ))
            )}
          </ul>
          <p className="mt-2 text-[12px] text-fb-muted">{estimate}. This size is an estimate.</p>
        </div>

        <details className="mt-3 text-[12px] text-fb-muted">
          <summary className="cursor-pointer">Unavailable options</summary>
          <ul className="mt-2 space-y-1">
            {UNSUPPORTED_EXPORT_OPTIONS.map((option) => (
              <li key={option.id}>
                <span className="text-fb-text">{option.label}.</span> {option.reason}
              </li>
            ))}
          </ul>
        </details>

        {items.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="Export queue">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 border border-white/10 px-2 py-2 text-[12px]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fb-text">{item.filename}</p>
                  <p className="text-fb-muted">
                    {item.status === 'running' ? label : item.status}
                    {item.message ? ` · ${item.message}` : ''}
                  </p>
                </div>
                {item.status === 'completed' && (
                  <button type="button" className="app-btn h-7 text-[12px]" onClick={() => download(item.id)}>
                    Download
                  </button>
                )}
                {(item.status === 'failed' || item.status === 'cancelled') && (
                  <button type="button" className="app-btn-quiet h-7 text-[12px]" onClick={() => retry(item.id)}>
                    Retry
                  </button>
                )}
                {(item.status === 'queued' || item.status === 'running') && (
                  <button type="button" className="app-btn-quiet h-7 text-[12px]" onClick={() => cancel(item.id)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="app-btn-quiet mr-auto">
            Close
          </button>
          <button
            type="button"
            className="app-btn"
            disabled={!readiness.ready}
            onClick={() => enqueue(settings)}
          >
            Add to queue
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-fb-muted">{label}</span>
      <span className="text-right">{children}</span>
    </label>
  )
}
