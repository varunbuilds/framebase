import { useEffect, useId } from 'react'
import { useEditorStore } from '@/stores/editor-store'
import { exportSizeFor } from './export-plan'
import { useExport } from './use-export'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const aspectRatio = useEditorStore((state) => state.document.canvas.aspectRatio)
  const size = exportSizeFor(aspectRatio)
  const { job, running, label, start, cancel, reset, downloadAgain } = useExport()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !running) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, running])

  const percent =
    job.status === 'rendering' || job.status === 'finalizing' ? job.percent : null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[380px] rounded-xl border border-fb-border bg-fb-panel p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-[16px] font-semibold text-fb-text">
          {job.status === 'complete'
            ? 'Export complete'
            : job.status === 'failed'
              ? 'Export failed'
              : running
                ? 'Exporting…'
                : 'Export'}
        </h2>

        {job.status === 'failed' ? (
          <div className="mt-3" role="alert">
            <p className="text-[13px] leading-relaxed text-fb-danger">{job.message}</p>
            {job.detail && job.detail !== job.message ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-[12px] text-fb-muted">
                  Technical details
                </summary>
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-fb-border bg-fb-app px-2.5 py-2 text-[11px] leading-snug text-fb-muted">
                  {job.detail}
                </pre>
              </details>
            ) : null}
          </div>
        ) : job.status === 'complete' ? (
          <p className="mt-3 text-[13px] leading-relaxed text-fb-muted">
            {job.filename} is ready.
          </p>
        ) : running ? (
          <div className="mt-4">
            <p className="text-[13px] text-fb-muted">{label}</p>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              aria-label={label ?? 'Exporting'}
            >
              <div
                className={`h-full rounded-full bg-fb-accent ${percent == null ? 'w-1/3 animate-pulse' : ''}`}
                style={percent == null ? undefined : { width: `${percent}%` }}
              />
            </div>
          </div>
        ) : (
          <dl className="mt-4 space-y-3 text-[13px]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-fb-muted">Format</dt>
              <dd className="font-medium text-fb-text">MP4</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-fb-muted">Resolution</dt>
              <dd className="text-right font-medium text-fb-text">
                {size.label}
                <span className="mt-0.5 block text-[11px] font-normal text-fb-subtle">
                  {aspectRatio}
                </span>
              </dd>
            </div>
          </dl>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {running ? (
            <button
              type="button"
              onClick={cancel}
              className="h-8 rounded-md px-3 text-[13px] text-fb-muted hover:text-fb-text"
            >
              Cancel export
            </button>
          ) : job.status === 'complete' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="mr-auto h-8 rounded-md px-3 text-[13px] text-fb-muted hover:text-fb-text"
              >
                Close
              </button>
              <button
                type="button"
                onClick={downloadAgain}
                className="h-8 rounded-md bg-white px-3 text-[13px] font-medium text-black"
              >
                Download
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  reset()
                  onClose()
                }}
                className="mr-auto h-8 rounded-md px-3 text-[13px] text-fb-muted hover:text-fb-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={start}
                className="h-8 rounded-md bg-white px-3 text-[13px] font-medium text-black"
              >
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
