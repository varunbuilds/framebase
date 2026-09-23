import { Film, Music2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getMediaSourceById,
  getSortedTracks,
  getTimelineDurationMs,
} from '@/features/editor/project'
import { useEditorStore } from '@/stores/editor-store'
import { getObjectUrl } from '@/lib/media/object-urls'
import type { Clip, Track } from '@/types/timeline'
import { clamp, formatTimecode } from '@/utils/time'

const TRACK_HEIGHT = 72
const RULER_HEIGHT = 28
const LABEL_WIDTH = 88

function msToPx(ms: number, pixelsPerSecond: number): number {
  return (ms / 1000) * pixelsPerSecond
}

function pxToMs(px: number, pixelsPerSecond: number): number {
  return Math.round((px / pixelsPerSecond) * 1000)
}

function VideoFilmstrip({ src, durationMs }: { src: string; durationMs: number }) {
  const [frames, setFrames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const video = document.createElement('video')
    video.src = src
    video.muted = true
    video.preload = 'auto'

    const captureFrames = async () => {
      const duration = Number.isFinite(video.duration)
        ? Math.min(video.duration, durationMs / 1000)
        : durationMs / 1000
      const count = Math.max(3, Math.min(8, Math.ceil(duration / 2)))
      const nextFrames: string[] = []
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 90
      const context = canvas.getContext('2d')
      if (!context) return
      for (let index = 0; index < count; index += 1) {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.onerror = () => resolve()
          video.currentTime = Math.min(
            Math.max(0, duration - 0.05),
            (duration * (index + 0.5)) / count,
          )
        })
        if (cancelled) return
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        nextFrames.push(canvas.toDataURL('image/jpeg', 0.72))
      }
      if (!cancelled) setFrames(nextFrames)
    }
    video.onloadedmetadata = () => void captureFrames()
    video.onerror = () => {
      if (!cancelled) setFrames([])
    }
    return () => {
      cancelled = true
      video.removeAttribute('src')
      video.load()
    }
  }, [durationMs, src])

  if (frames.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-70" aria-hidden>
      {frames.map((frame, index) => (
        <img
          key={`${index}-${frame.slice(-12)}`}
          src={frame}
          className="h-full min-w-0 flex-1 object-cover"
          alt=""
        />
      ))}
    </div>
  )
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
  const objectUrl = media ? getObjectUrl(media.id) : undefined

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
      } ${selected ? 'ring-1 ring-fb-accent ring-offset-1 ring-offset-fb-surface' : ''}`}
      style={{ left, width }}
    >
      {isVideo && objectUrl ? (
        <VideoFilmstrip src={objectUrl} durationMs={durationMs} />
      ) : (
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, transparent 0 7px, rgba(116, 225, 183, .38) 8px 10px, transparent 11px 18px)',
          }}
          aria-hidden
        />
      )}
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
      <div className="relative z-10 min-w-0 flex-1 px-2 py-2">
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
  const isPlaying = useEditorStore((state) => state.ui.isPlaying)
  const pixelsPerSecond = useEditorStore((state) => state.ui.pixelsPerSecond)
  const timelineScrollLeft = useEditorStore(
    (state) => state.ui.timelineScrollLeft,
  )
  const selectedClipId = useEditorStore((state) => state.ui.selectedClipId)
  const clipDrag = useEditorStore((state) => state.clipDrag)
  const seekTo = useEditorStore((state) => state.seekTo)
  const setPixelsPerSecond = useEditorStore((state) => state.setPixelsPerSecond)
  const setTimelineScrollLeft = useEditorStore(
    (state) => state.setTimelineScrollLeft,
  )
  const selectClip = useEditorStore((state) => state.selectClip)
  const setClipDrag = useEditorStore((state) => state.setClipDrag)
  const moveClipTo = useEditorStore((state) => state.moveClipTo)
  const trimClipTo = useEditorStore((state) => state.trimClipTo)
  const removeClip = useEditorStore((state) => state.removeClip)

  const scrollRef = useRef<HTMLDivElement>(null)
  const dragDeltaMsRef = useRef(0)
  const isScrubbingRef = useRef(false)
  const restoredScrollRef = useRef(false)
  const [dragDeltaMs, setDragDeltaMs] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)

  const tracks = getSortedTracks(document)
  const durationMs = getTimelineDurationMs(document)
  const contentWidth = Math.max(
    800,
    viewportWidth,
    msToPx(durationMs, pixelsPerSecond) + 120,
  )

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const viewport = scrollRef.current
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const x = clientX - bounds.left + viewport.scrollLeft
      seekTo(clamp(pxToMs(x, pixelsPerSecond), 0, durationMs))
    },
    [durationMs, pixelsPerSecond, seekTo],
  )

  const zoomAtClientX = useCallback(
    (clientX: number, direction: 1 | -1) => {
      const viewport = scrollRef.current
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const cursorOffset = clientX - bounds.left
      const timeAtCursorMs = pxToMs(
        viewport.scrollLeft + cursorOffset,
        pixelsPerSecond,
      )
      const nextPixelsPerSecond = clamp(
        pixelsPerSecond + direction * 10,
        20,
        240,
      )
      if (nextPixelsPerSecond === pixelsPerSecond) return
      setPixelsPerSecond(nextPixelsPerSecond)
      requestAnimationFrame(() => {
        const nextLeft =
          msToPx(timeAtCursorMs, nextPixelsPerSecond) - cursorOffset
        viewport.scrollLeft = Math.max(0, nextLeft)
      })
    },
    [pixelsPerSecond, setPixelsPerSecond],
  )

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
    const visibleDurationMs = pxToMs(viewportWidth, pixelsPerSecond)
    const rulerEndMs = Math.max(durationMs + stepMs, visibleDurationMs + stepMs)
    for (let ms = 0; ms <= rulerEndMs; ms += stepMs) {
      marks.push({ ms, major: ms % (stepMs * 2) === 0 || stepMs >= 2000 })
    }
    return marks
  }, [durationMs, pixelsPerSecond, viewportWidth])

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
    const onMove = (event: PointerEvent) => {
      if (isScrubbingRef.current) seekFromClientX(event.clientX)
    }
    const onUp = () => {
      isScrubbingRef.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [seekFromClientX])

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport || restoredScrollRef.current) return
    viewport.scrollLeft = timelineScrollLeft
    restoredScrollRef.current = true
  }, [timelineScrollLeft])

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) return
    const resizeObserver = new ResizeObserver(() => {
      setViewportWidth(viewport.clientWidth)
    })
    resizeObserver.observe(viewport)
    setViewportWidth(viewport.clientWidth)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!isPlaying) return
    const viewport = scrollRef.current
    if (!viewport) return
    const playheadX = msToPx(playheadMs, pixelsPerSecond)
    const inset = 80
    if (
      playheadX < viewport.scrollLeft + inset ||
      playheadX > viewport.scrollLeft + viewport.clientWidth - inset
    ) {
      viewport.scrollTo({
        left: Math.max(0, playheadX - viewport.clientWidth / 2),
        behavior: 'auto',
      })
    }
  }, [isPlaying, pixelsPerSecond, playheadMs])

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
    <section className="flex h-[260px] w-full min-w-0 shrink-0 select-none flex-col border-t border-fb-border bg-fb-surface">
      <div className="flex h-10 items-center gap-2 border-b border-fb-border bg-fb-panel px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Timeline
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setPixelsPerSecond(pixelsPerSecond - 20)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-white/70 hover:bg-white/[0.08]"
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
            className="inline-flex h-6 w-6 items-center justify-center rounded text-white/70 hover:bg-white/[0.08]"
          >
            <ZoomIn size={14} strokeWidth={1.75} />
          </button>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-fb-muted">
          {formatTimecode(playheadMs)}
        </span>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
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
              className="flex items-center gap-2 border-b border-fb-border px-2 text-[11px] font-medium text-fb-muted"
              style={{ height: TRACK_HEIGHT }}
            >
              {track.kind === 'video' ? (
                <Film size={14} strokeWidth={1.6} />
              ) : (
                <Music2 size={14} strokeWidth={1.6} />
              )}
              {track.name}
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto"
          onClick={() => selectClip(null)}
          onScroll={(event) => setTimelineScrollLeft(event.currentTarget.scrollLeft)}
          onWheel={(event) => {
            if (!(event.ctrlKey || event.metaKey)) return
            event.preventDefault()
            zoomAtClientX(event.clientX, event.deltaY < 0 ? 1 : -1)
          }}
        >
          <div style={{ width: contentWidth, minWidth: '100%', minHeight: '100%' }}>
            <div
              className="relative border-b border-fb-border bg-fb-ruler"
              style={{ height: RULER_HEIGHT }}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                isScrubbingRef.current = true
                seekFromClientX(event.clientX)
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
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  event.preventDefault()
                  isScrubbingRef.current = true
                  seekFromClientX(event.clientX)
                }}
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
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-fb-playhead/80"
              style={{ left: playheadLeft }}
              aria-hidden
            >
              <div className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-fb-playhead shadow-[0_0_8px_rgba(255,255,255,0.45)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
