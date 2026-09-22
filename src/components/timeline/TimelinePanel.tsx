import { ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getMediaSourceById,
  getSortedTracks,
  getTimelineDurationMs,
} from '@/features/editor/project'
import { useEditorStore } from '@/stores/editor-store'
import type { Clip, Track } from '@/types/timeline'
import { clamp, formatTimecode } from '@/utils/time'

const TRACK_HEIGHT = 44
const RULER_HEIGHT = 28
const LABEL_WIDTH = 88

function msToPx(ms: number, pixelsPerSecond: number): number {
  return (ms / 1000) * pixelsPerSecond
}

function pxToMs(px: number, pixelsPerSecond: number): number {
  return Math.round((px / pixelsPerSecond) * 1000)
}

function TimelineClipBlock({
  clip,
  track,
  pixelsPerSecond,
  selected,
  dragDeltaMs,
  onSelect,
  onPointerDownMove,
  onPointerDownTrim,
}: {
  clip: Clip
  track: Track
  pixelsPerSecond: number
  selected: boolean
  dragDeltaMs: number
  onSelect: () => void
  onPointerDownMove: (clientX: number) => void
  onPointerDownTrim: (edge: 'trim-in' | 'trim-out', clientX: number) => void
}) {
  const document = useEditorStore((state) => state.document)
  const media = getMediaSourceById(document, clip.mediaSourceId)
  const drag = useEditorStore((state) => state.clipDrag)

  let timelineStartMs = clip.timelineStartMs
  let sourceInMs = clip.sourceInMs
  let sourceOutMs = clip.sourceOutMs

  if (drag && drag.clipId === clip.id) {
    if (drag.mode === 'move') {
      timelineStartMs = Math.max(0, drag.originTimelineStartMs + dragDeltaMs)
    } else if (drag.mode === 'trim-in') {
      const nextIn = clamp(
        drag.originSourceInMs + dragDeltaMs,
        0,
        drag.originSourceOutMs - 100,
      )
      const delta = nextIn - drag.originSourceInMs
      sourceInMs = nextIn
      timelineStartMs = Math.max(0, drag.originTimelineStartMs + delta)
    } else if (drag.mode === 'trim-out') {
      const maxOut = media?.durationMs ?? drag.originSourceOutMs
      sourceOutMs = clamp(
        drag.originSourceOutMs + dragDeltaMs,
        drag.originSourceInMs + 100,
        maxOut,
      )
    }
  }

  const durationMs = sourceOutMs - sourceInMs
  const left = msToPx(timelineStartMs, pixelsPerSecond)
  const width = Math.max(8, msToPx(durationMs, pixelsPerSecond))
  const isVideo = track.kind === 'video'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${clip.label ?? media?.name ?? 'Clip'} on ${track.name}`}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement
        if (target.closest('[data-trim]')) return
        event.stopPropagation()
        onSelect()
        onPointerDownMove(event.clientX)
      }}
      className={`absolute top-1.5 flex h-[calc(100%-12px)] cursor-grab items-stretch overflow-hidden rounded-sm border active:cursor-grabbing ${
        isVideo
          ? 'border-fb-video-border bg-fb-video'
          : 'border-fb-audio-border bg-fb-audio'
      } ${selected ? 'ring-2 ring-fb-accent ring-offset-1' : ''}`}
      style={{ left, width }}
    >
      <button
        type="button"
        data-trim="in"
        aria-label="Trim clip start"
        className="w-1.5 shrink-0 cursor-ew-resize bg-black/10 hover:bg-black/25"
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
          onPointerDownTrim('trim-in', event.clientX)
        }}
      />
      <div className="min-w-0 flex-1 px-1.5 py-1">
        <div className="truncate text-[10px] font-medium text-fb-text">
          {clip.label ?? media?.name ?? 'Clip'}
        </div>
        <div className="truncate text-[9px] text-fb-muted">
          {formatTimecode(durationMs)}
        </div>
      </div>
      <button
        type="button"
        data-trim="out"
        aria-label="Trim clip end"
        className="w-1.5 shrink-0 cursor-ew-resize bg-black/10 hover:bg-black/25"
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
          onPointerDownTrim('trim-out', event.clientX)
        }}
      />
    </div>
  )
}

export function TimelinePanel() {
  const document = useEditorStore((state) => state.document)
  const playheadMs = useEditorStore((state) => state.ui.playheadMs)
  const pixelsPerSecond = useEditorStore((state) => state.ui.pixelsPerSecond)
  const selectedClipId = useEditorStore((state) => state.ui.selectedClipId)
  const clipDrag = useEditorStore((state) => state.clipDrag)
  const setPlayheadMs = useEditorStore((state) => state.setPlayheadMs)
  const setPixelsPerSecond = useEditorStore((state) => state.setPixelsPerSecond)
  const selectClip = useEditorStore((state) => state.selectClip)
  const setClipDrag = useEditorStore((state) => state.setClipDrag)
  const moveClipTo = useEditorStore((state) => state.moveClipTo)
  const trimClipTo = useEditorStore((state) => state.trimClipTo)
  const removeClip = useEditorStore((state) => state.removeClip)

  const scrollRef = useRef<HTMLDivElement>(null)
  const dragDeltaMsRef = useRef(0)
  const [dragDeltaMs, setDragDeltaMs] = useState(0)

  const tracks = getSortedTracks(document)
  const durationMs = getTimelineDurationMs(document)
  const contentWidth = Math.max(800, msToPx(durationMs, pixelsPerSecond) + 120)

  const rulerMarks = useMemo(() => {
    const marks: Array<{ ms: number; major: boolean }> = []
    const stepMs =
      pixelsPerSecond >= 120
        ? 500
        : pixelsPerSecond >= 60
          ? 1000
          : pixelsPerSecond >= 40
            ? 2000
            : 5000
    for (let ms = 0; ms <= durationMs + stepMs; ms += stepMs) {
      marks.push({ ms, major: ms % (stepMs * 2) === 0 || stepMs >= 2000 })
    }
    return marks
  }, [durationMs, pixelsPerSecond])

  const commitDrag = useCallback(() => {
    const drag = useEditorStore.getState().clipDrag
    if (!drag) return

    const deltaMs = dragDeltaMsRef.current
    const clip = useEditorStore
      .getState()
      .document.clips.find((item) => item.id === drag.clipId)

    if (!clip) {
      setClipDrag(null)
      dragDeltaMsRef.current = 0
      setDragDeltaMs(0)
      return
    }

    if (drag.mode === 'move') {
      moveClipTo(drag.clipId, Math.max(0, drag.originTimelineStartMs + deltaMs))
    } else if (drag.mode === 'trim-in') {
      const nextIn = clamp(
        drag.originSourceInMs + deltaMs,
        0,
        drag.originSourceOutMs - 100,
      )
      const appliedDelta = nextIn - drag.originSourceInMs
      trimClipTo(drag.clipId, {
        sourceInMs: nextIn,
        timelineStartMs: Math.max(0, drag.originTimelineStartMs + appliedDelta),
        sourceOutMs: drag.originSourceOutMs,
      })
    } else if (drag.mode === 'trim-out') {
      const media = getMediaSourceById(
        useEditorStore.getState().document,
        clip.mediaSourceId,
      )
      const maxOut = media?.durationMs ?? drag.originSourceOutMs
      const nextOut = clamp(
        drag.originSourceOutMs + deltaMs,
        drag.originSourceInMs + 100,
        maxOut,
      )
      trimClipTo(drag.clipId, {
        sourceOutMs: nextOut,
        sourceInMs: drag.originSourceInMs,
        timelineStartMs: drag.originTimelineStartMs,
      })
    }

    setClipDrag(null)
    dragDeltaMsRef.current = 0
    setDragDeltaMs(0)
  }, [moveClipTo, setClipDrag, trimClipTo])

  useEffect(() => {
    if (!clipDrag) return

    const onMove = (event: PointerEvent) => {
      const next = pxToMs(event.clientX - clipDrag.originClientX, pixelsPerSecond)
      dragDeltaMsRef.current = next
      setDragDeltaMs(next)
    }

    const onUp = () => {
      commitDrag()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [clipDrag, commitDrag, pixelsPerSecond])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (selectedClipId) {
        event.preventDefault()
        removeClip(selectedClipId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [removeClip, selectedClipId])

  const playheadLeft = msToPx(playheadMs, pixelsPerSecond)

  return (
    <section className="flex h-[240px] shrink-0 flex-col border-t border-fb-border bg-fb-surface">
      <div className="flex h-9 items-center gap-2 border-b border-fb-border px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Timeline
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setPixelsPerSecond(pixelsPerSecond - 20)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fb-text hover:bg-fb-app"
          >
            <ZoomOut size={14} strokeWidth={1.75} />
          </button>
          <span className="w-12 text-center font-mono text-[10px] text-fb-muted">
            {pixelsPerSecond}px/s
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setPixelsPerSecond(pixelsPerSecond + 20)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fb-text hover:bg-fb-app"
          >
            <ZoomIn size={14} strokeWidth={1.75} />
          </button>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-fb-muted">
          {formatTimecode(playheadMs)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="shrink-0 border-r border-fb-border bg-fb-panel"
          style={{ width: LABEL_WIDTH }}
        >
          <div
            className="border-b border-fb-border bg-fb-ruler"
            style={{ height: RULER_HEIGHT }}
          />
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex items-center border-b border-fb-border px-2 text-[11px] font-medium text-fb-muted"
              style={{ height: TRACK_HEIGHT }}
            >
              {track.name}
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto"
          onClick={() => selectClip(null)}
        >
          <div style={{ width: contentWidth, minHeight: '100%' }}>
            <div
              className="relative border-b border-fb-border bg-fb-ruler"
              style={{ height: RULER_HEIGHT }}
              onPointerDown={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                const x =
                  event.clientX -
                  bounds.left +
                  (scrollRef.current?.scrollLeft ?? 0)
                setPlayheadMs(clamp(pxToMs(x, pixelsPerSecond), 0, durationMs))
              }}
            >
              {rulerMarks.map((mark) => (
                <div
                  key={mark.ms}
                  className="absolute top-0 h-full"
                  style={{ left: msToPx(mark.ms, pixelsPerSecond) }}
                >
                  <div
                    className={`w-px bg-fb-border-strong ${
                      mark.major
                        ? 'h-full'
                        : 'mt-3 h-[calc(100%-12px)]'
                    }`}
                  />
                  {mark.major && (
                    <span className="absolute top-1 left-1 font-mono text-[9px] text-fb-subtle">
                      {formatTimecode(mark.ms)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {tracks.map((track) => (
              <div
                key={track.id}
                className="relative border-b border-fb-border bg-fb-surface"
                style={{ height: TRACK_HEIGHT }}
              >
                {document.clips
                  .filter((clip) => clip.trackId === track.id)
                  .map((clip) => (
                    <TimelineClipBlock
                      key={clip.id}
                      clip={clip}
                      track={track}
                      pixelsPerSecond={pixelsPerSecond}
                      selected={clip.id === selectedClipId}
                      dragDeltaMs={
                        clipDrag?.clipId === clip.id ? dragDeltaMs : 0
                      }
                      onSelect={() => selectClip(clip.id)}
                      onPointerDownMove={(clientX) => {
                        dragDeltaMsRef.current = 0
                        setDragDeltaMs(0)
                        setClipDrag({
                          clipId: clip.id,
                          mode: 'move',
                          originClientX: clientX,
                          originTimelineStartMs: clip.timelineStartMs,
                          originSourceInMs: clip.sourceInMs,
                          originSourceOutMs: clip.sourceOutMs,
                        })
                      }}
                      onPointerDownTrim={(edge, clientX) => {
                        dragDeltaMsRef.current = 0
                        setDragDeltaMs(0)
                        setClipDrag({
                          clipId: clip.id,
                          mode: edge,
                          originClientX: clientX,
                          originTimelineStartMs: clip.timelineStartMs,
                          originSourceInMs: clip.sourceInMs,
                          originSourceOutMs: clip.sourceOutMs,
                        })
                      }}
                    />
                  ))}
              </div>
            ))}

            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-fb-playhead"
              style={{ left: playheadLeft }}
              aria-hidden
            >
              <div className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-sm bg-fb-playhead" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
