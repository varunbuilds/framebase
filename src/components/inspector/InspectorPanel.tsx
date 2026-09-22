import { useMemo, type ReactNode } from 'react'
import { getMediaSourceById } from '@/features/editor/project'
import { useEditorStore } from '@/stores/editor-store'
import { formatDurationShort, formatTimecode, msToSeconds } from '@/utils/time'

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-fb-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

function NumberField({
  label,
  valueMs,
  onCommit,
  min = 0,
  max,
  step = 0.1,
}: {
  label: string
  valueMs: number
  onCommit: (ms: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        step={step}
        min={msToSeconds(min)}
        max={max != null ? msToSeconds(max) : undefined}
        value={Number((valueMs / 1000).toFixed(3))}
        onChange={(event) => {
          const seconds = Number(event.target.value)
          if (!Number.isFinite(seconds)) return
          onCommit(Math.round(seconds * 1000))
        }}
        className="h-7 rounded border border-fb-border bg-white px-2 font-mono text-[12px] text-fb-text"
      />
    </Field>
  )
}

export function InspectorPanel() {
  const document = useEditorStore((state) => state.document)
  const selectedClipId = useEditorStore((state) => state.ui.selectedClipId)
  const trimClipTo = useEditorStore((state) => state.trimClipTo)
  const moveClipTo = useEditorStore((state) => state.moveClipTo)
  const updateSelectedClipLabel = useEditorStore(
    (state) => state.updateSelectedClipLabel,
  )
  const removeClip = useEditorStore((state) => state.removeClip)

  const clip = useMemo(
    () => document.clips.find((item) => item.id === selectedClipId) ?? null,
    [document.clips, selectedClipId],
  )

  const media = clip ? getMediaSourceById(document, clip.mediaSourceId) : null
  const durationMs = clip ? clip.sourceOutMs - clip.sourceInMs : 0

  return (
    <aside className="flex h-full min-h-0 w-[260px] shrink-0 flex-col border-l border-fb-border bg-fb-panel">
      <div className="flex h-9 items-center border-b border-fb-border px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Inspector
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!clip || !media ? (
          <div className="flex h-full items-center justify-center px-2 text-center">
            <p className="text-[12px] leading-relaxed text-fb-muted">
              Select a clip to inspect timeline position, duration, and source
              in/out points.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Name">
              <input
                type="text"
                value={clip.label ?? media.name}
                onChange={(event) => updateSelectedClipLabel(event.target.value)}
                className="h-7 rounded border border-fb-border bg-white px-2 text-[12px] text-fb-text"
              />
            </Field>

            <div className="rounded border border-fb-border bg-white px-2.5 py-2 text-[11px] text-fb-muted">
              <div className="flex justify-between gap-2">
                <span>Source</span>
                <span className="truncate text-fb-text">{media.name}</span>
              </div>
              <div className="mt-1 flex justify-between gap-2">
                <span>Kind</span>
                <span className="capitalize text-fb-text">{media.kind}</span>
              </div>
              <div className="mt-1 flex justify-between gap-2">
                <span>Duration</span>
                <span className="font-mono text-fb-text">
                  {formatDurationShort(durationMs)}
                </span>
              </div>
            </div>

            <NumberField
              label="Timeline start (s)"
              valueMs={clip.timelineStartMs}
              onCommit={(ms) => moveClipTo(clip.id, ms)}
            />

            <NumberField
              label="Source in (s)"
              valueMs={clip.sourceInMs}
              max={clip.sourceOutMs - 100}
              onCommit={(ms) => {
                const delta = ms - clip.sourceInMs
                trimClipTo(clip.id, {
                  sourceInMs: ms,
                  timelineStartMs: clip.timelineStartMs + delta,
                })
              }}
            />

            <NumberField
              label="Source out (s)"
              valueMs={clip.sourceOutMs}
              min={clip.sourceInMs + 100}
              max={media.durationMs}
              onCommit={(ms) => trimClipTo(clip.id, { sourceOutMs: ms })}
            />

            <div className="rounded border border-fb-border bg-fb-app px-2.5 py-2 font-mono text-[11px] text-fb-muted">
              <div>In {formatTimecode(clip.sourceInMs)}</div>
              <div>Out {formatTimecode(clip.sourceOutMs)}</div>
              <div className="mt-1 text-fb-text">
                Length {formatTimecode(durationMs)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => removeClip(clip.id)}
              className="mt-1 h-7 rounded border border-red-200 bg-white text-[12px] font-medium text-fb-danger hover:bg-red-50"
            >
              Delete clip
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
