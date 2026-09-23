import { Film, Link2, Link2Off, Music2, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { AudioWaveform } from '@/components/timeline/AudioWaveform'
import {
  planClipMove,
  type ClipMovePlan,
} from '@/features/editor/operations'
import {
  getLinkedClips,
  getMediaSourceById,
  getSortedTracks,
  getTimelineDurationMs,
} from '@/features/editor/project'
import { useEditorStore } from '@/stores/editor-store'
import { getObjectUrl } from '@/lib/media/object-urls'
import type { Clip, Track } from '@/types/timeline'
import { clamp, formatTimecode } from '@/utils/time'

const TRACK_HEIGHT = 104
const RULER_HEIGHT = 28
const LABEL_WIDTH = 88
const TIMELINE_MIN_HEIGHT = 220
const TIMELINE_MAX_HEIGHT = 720
/** Leave room for the toolbar + a usable preview region. */
const MIN_UPPER_AREA_PX = 200
const TOOLBAR_HEIGHT_PX = 44

function getTimelineHeightMax(): number {
  if (typeof window === 'undefined') return TIMELINE_MAX_HEIGHT
  const viewportMax = window.innerHeight - TOOLBAR_HEIGHT_PX - MIN_UPPER_AREA_PX
  return Math.max(
    TIMELINE_MIN_HEIGHT,
    Math.min(TIMELINE_MAX_HEIGHT, viewportMax),
  )
}

function clampTimelineHeight(height: number): number {
  return clamp(Math.round(height), TIMELINE_MIN_HEIGHT, getTimelineHeightMax())
}

function msToPx(ms: number, pixelsPerSecond: number): number {
  return (ms / 1000) * pixelsPerSecond
}

function pxToMs(px: number, pixelsPerSecond: number): number {
  return Math.round((px / pixelsPerSecond) * 1000)
}

/** Hit-test a track row under the pointer (content area, below the ruler). */
function trackIdAtClientY(args: {
  clientY: number
  contentTop: number
  scrollTop: number
  tracks: Track[]
  kind?: Track['kind']
}): string | undefined {
  const y = args.clientY - args.contentTop + args.scrollTop - RULER_HEIGHT
  if (args.tracks.length === 0) return undefined

  if (y < 0) {
    const top = args.tracks[0]
    return top && (!args.kind || top.kind === args.kind) ? top.id : undefined
  }

  const index = Math.min(
    args.tracks.length - 1,
    Math.max(0, Math.floor(y / TRACK_HEIGHT)),
  )
  const track = args.tracks[index]
  if (!track) return undefined
  if (args.kind && track.kind !== args.kind) return undefined
  return track.id
}


function VideoFilmstrip({
  src,
  durationMs,
}: {
  src: string
  durationMs: number
}) {
  const [frames, setFrames] = useState<string[]>([])
  // Duration-based frame count — avoid re-decoding on every zoom width change.
  const frameCount = Math.max(3, Math.min(12, Math.ceil(durationMs / 1500)))

  useEffect(() => {
    let cancelled = false
    const video = document.createElement('video')
    video.src = src
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true

    const captureFrames = async () => {
      const duration = Number.isFinite(video.duration)
        ? Math.min(video.duration, durationMs / 1000)
        : durationMs / 1000
      const nextFrames: string[] = []
      const canvas = document.createElement('canvas')
      canvas.width = 120
      canvas.height = 68
      const context = canvas.getContext('2d')
      if (!context) return
      for (let index = 0; index < frameCount; index += 1) {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.onerror = () => resolve()
          video.currentTime = Math.min(
            Math.max(0, duration - 0.05),
            (duration * (index + 0.5)) / frameCount,
          )
        })
        if (cancelled) return
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        nextFrames.push(canvas.toDataURL('image/jpeg', 0.7))
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
  }, [durationMs, frameCount, src])

  if (frames.length === 0) {
    return <div className="h-full w-full bg-[#1a2228]" aria-hidden />
  }

  return (
    <div className="pointer-events-none flex h-full w-full overflow-hidden" aria-hidden>
      {frames.map((frame, index) => (
        <img
          key={`${index}-${frame.slice(-12)}`}
          src={frame}
          className="h-full min-w-0 flex-1 object-cover"
          alt=""
          draggable={false}
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
  linkedHighlight,
  dragDeltaMs,
  previewTimelineStartMs,
  onSelect,
  onPointerDownMove,
  onPointerDownTrim,
}: {
  clip: Clip
  track: Track
  pixelsPerSecond: number
  selected: boolean
  linkedHighlight: boolean
  dragDeltaMs: number
  /** When set (live move plan), overrides timeline start instead of delta. */
  previewTimelineStartMs?: number
  onSelect: () => void
  onPointerDownMove: (clientX: number, clientY: number) => void
  onPointerDownTrim: (edge: 'trim-in' | 'trim-out', clientX: number) => void
}) {
  const document = useEditorStore((state) => state.document)
  const media = getMediaSourceById(document, clip.mediaSourceId)
  const drag = useEditorStore((state) => state.clipDrag)

  let timelineStartMs = clip.timelineStartMs
  let sourceInMs = clip.sourceInMs
  let sourceOutMs = clip.sourceOutMs

  const isDragParticipant =
    drag != null &&
    (drag.clipId === clip.id ||
      (Boolean(drag.linkGroupId) && clip.linkGroupId === drag.linkGroupId))

  if (isDragParticipant && drag) {
    if (drag.mode === 'move' && previewTimelineStartMs != null) {
      timelineStartMs = previewTimelineStartMs
    } else if (drag.mode === 'move') {
      timelineStartMs = Math.max(0, clip.timelineStartMs + dragDeltaMs)
    } else if (drag.mode === 'trim-in') {
      const nextIn = clamp(
        clip.sourceInMs + dragDeltaMs,
        0,
        clip.sourceOutMs - 100,
      )
      const delta = nextIn - clip.sourceInMs
      sourceInMs = nextIn
      timelineStartMs = Math.max(0, clip.timelineStartMs + delta)
    } else if (drag.mode === 'trim-out') {
      const maxOut = media?.durationMs ?? clip.sourceOutMs
      sourceOutMs = clamp(
        clip.sourceOutMs + dragDeltaMs,
        clip.sourceInMs + 100,
        maxOut,
      )
    }
  }

  const durationMs = sourceOutMs - sourceInMs
  const left = msToPx(timelineStartMs, pixelsPerSecond)
  const width = Math.max(8, msToPx(durationMs, pixelsPerSecond))
  const isVideo = track.kind === 'video'
  const objectUrl = media ? getObjectUrl(media.id) : undefined
  const title = clip.label ?? media?.name ?? 'Clip'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${title} on ${track.name}`}
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
        onPointerDownMove(event.clientX, event.clientY)
      }}
      className={`absolute top-1.5 z-0 flex h-[calc(100%-12px)] cursor-grab flex-col overflow-hidden rounded-md border active:cursor-grabbing ${
        isVideo
          ? 'border-[#2a3a45] bg-[#151c22]'
          : 'border-[#1f3d34] bg-[#13241f]'
      } ${
        selected
          ? 'ring-1 ring-fb-accent'
          : linkedHighlight
            ? 'ring-1 ring-fb-accent/70'
            : ''
      }`}
      style={{ left, width }}
    >
      <div className="relative flex h-[22px] shrink-0 items-center bg-[#243038] px-2">
        <span className="truncate text-[10px] font-medium leading-none text-white/90">
          {title}
        </span>
      </div>

      <div
        className={`relative min-h-0 flex-1 overflow-hidden ${
          isVideo ? 'bg-[#1a2228]' : 'bg-[#16352c]'
        }`}
      >
        {isVideo && objectUrl ? (
          <VideoFilmstrip src={objectUrl} durationMs={durationMs} />
        ) : objectUrl && media ? (
          <AudioWaveform
            mediaSourceId={media.id}
            src={objectUrl}
            sourceInMs={sourceInMs}
            sourceOutMs={sourceOutMs}
            mediaDurationMs={media.durationMs}
            widthPx={width}
          />
        ) : (
          <div className="h-full w-full bg-black/20" aria-hidden />
        )}
      </div>

      <button
        type="button"
        data-trim="in"
        aria-label="Trim clip start"
        className="absolute inset-y-0 left-0 z-[1] w-1.5 cursor-ew-resize bg-transparent hover:bg-white/25"
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
          onPointerDownTrim('trim-in', event.clientX)
        }}
      />
      <button
        type="button"
        data-trim="out"
        aria-label="Trim clip end"
        className="absolute inset-y-0 right-0 z-[1] w-1.5 cursor-ew-resize bg-transparent hover:bg-white/25"
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
  const timelineHeightPx = useEditorStore((state) => state.ui.timelineHeightPx)
  const selectedClipId = useEditorStore((state) => state.ui.selectedClipId)
  const clipDrag = useEditorStore((state) => state.clipDrag)
  const seekTo = useEditorStore((state) => state.seekTo)
  const setPixelsPerSecond = useEditorStore((state) => state.setPixelsPerSecond)
  const setTimelineScrollLeft = useEditorStore(
    (state) => state.setTimelineScrollLeft,
  )
  const setTimelineHeightPx = useEditorStore(
    (state) => state.setTimelineHeightPx,
  )
  const selectClip = useEditorStore((state) => state.selectClip)
  const setClipDrag = useEditorStore((state) => state.setClipDrag)
  const moveClipTo = useEditorStore((state) => state.moveClipTo)
  const trimClipTo = useEditorStore((state) => state.trimClipTo)
  const removeClip = useEditorStore((state) => state.removeClip)
  const linkSelectedClip = useEditorStore((state) => state.linkSelectedClip)
  const unlinkSelectedClip = useEditorStore((state) => state.unlinkSelectedClip)

  const scrollRef = useRef<HTMLDivElement>(null)
  const tracksContentRef = useRef<HTMLDivElement>(null)
  const dragDeltaMsRef = useRef(0)
  const dragPreferredTrackIdRef = useRef<string | undefined>(undefined)
  const isScrubbingRef = useRef(false)
  const restoredScrollRef = useRef(false)
  const [dragDeltaMs, setDragDeltaMs] = useState(0)
  const [dragPreferredTrackId, setDragPreferredTrackId] = useState<
    string | undefined
  >(undefined)
  const [viewportWidth, setViewportWidth] = useState(0)

  const tracks = getSortedTracks(document)
  const durationMs = getTimelineDurationMs(document)
  const selectedClip = selectedClipId
    ? document.clips.find((clip) => clip.id === selectedClipId)
    : undefined
  const selectedLinkGroupId = selectedClip?.linkGroupId
  const selectedIsLinked = Boolean(
    selectedClipId && getLinkedClips(document, selectedClipId).length > 1,
  )
  const canLinkSelected = Boolean(
    selectedClip &&
      !selectedIsLinked &&
      document.clips.some((candidate) => {
        if (candidate.id === selectedClip.id) return false
        if (candidate.mediaSourceId !== selectedClip.mediaSourceId) return false
        if (candidate.linkGroupId) return false
        const selectedTrack = document.tracks.find(
          (track) => track.id === selectedClip.trackId,
        )
        const candidateTrack = document.tracks.find(
          (track) => track.id === candidate.trackId,
        )
        return (
          selectedTrack != null &&
          candidateTrack != null &&
          selectedTrack.kind !== candidateTrack.kind
        )
      }),
  )
  const contentWidth = Math.max(
    800,
    viewportWidth,
    msToPx(durationMs, pixelsPerSecond) + 120,
  )

  const primaryDragClip =
    clipDrag != null
      ? document.clips.find((clip) => clip.id === clipDrag.clipId)
      : undefined
  const primaryDragKind = primaryDragClip
    ? document.tracks.find((track) => track.id === primaryDragClip.trackId)
        ?.kind
    : undefined

  const movePlanSeedRef = useRef<Track[] | undefined>(undefined)

  const movePlan: ClipMovePlan | null = useMemo(() => {
    if (!clipDrag || clipDrag.mode !== 'move') {
      movePlanSeedRef.current = undefined
      return null
    }
    const plan = planClipMove({
      document,
      clipId: clipDrag.clipId,
      timelineStartMs: Math.max(
        0,
        clipDrag.originTimelineStartMs + dragDeltaMs,
      ),
      trackId: dragPreferredTrackId,
      seedTracks: movePlanSeedRef.current,
    })
    if ('error' in plan) return null
    movePlanSeedRef.current = plan.tracks
    return plan
  }, [clipDrag, document, dragDeltaMs, dragPreferredTrackId])

  const displayTracks = useMemo(() => {
    if (!movePlan) return tracks
    return getSortedTracks({ ...document, tracks: movePlan.tracks })
  }, [document, movePlan, tracks])

  const placementByClipId = useMemo(() => {
    if (!movePlan) return null
    return new Map(
      movePlan.placements.map((placement) => [placement.clipId, placement]),
    )
  }, [movePlan])

  const displayTracksRef = useRef(displayTracks)
  displayTracksRef.current = displayTracks

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const viewport = scrollRef.current
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const x =
        clientX - bounds.left + viewport.scrollLeft - LABEL_WIDTH
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
        viewport.scrollLeft + cursorOffset - LABEL_WIDTH,
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
          msToPx(timeAtCursorMs, nextPixelsPerSecond) -
          cursorOffset +
          LABEL_WIDTH
        viewport.scrollLeft = Math.max(0, nextLeft)
      })
    },
    [pixelsPerSecond, setPixelsPerSecond],
  )

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) return

    // Non-passive so ctrl/meta+wheel never falls through to browser page-zoom,
    // including when timeline zoom is already at min/max.
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      zoomAtClientX(event.clientX, event.deltaY < 0 ? 1 : -1)
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [zoomAtClientX])

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
    const preferredTrackId = dragPreferredTrackIdRef.current
    const clip = useEditorStore
      .getState()
      .document.clips.find((item) => item.id === drag.clipId)

    if (!clip) {
      setClipDrag(null)
      dragDeltaMsRef.current = 0
      dragPreferredTrackIdRef.current = undefined
      setDragDeltaMs(0)
      setDragPreferredTrackId(undefined)
      return
    }

    if (drag.mode === 'move') {
      moveClipTo(
        drag.clipId,
        Math.max(0, drag.originTimelineStartMs + deltaMs),
        preferredTrackId,
      )
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
    dragPreferredTrackIdRef.current = undefined
    setDragDeltaMs(0)
    setDragPreferredTrackId(undefined)
  }, [moveClipTo, setClipDrag, trimClipTo])

  useEffect(() => {
    if (!clipDrag) return

    const onMove = (event: PointerEvent) => {
      const next = pxToMs(event.clientX - clipDrag.originClientX, pixelsPerSecond)
      dragDeltaMsRef.current = next
      setDragDeltaMs(next)

      if (clipDrag.mode === 'move') {
        const viewport = scrollRef.current
        if (viewport && primaryDragKind) {
          const bounds = viewport.getBoundingClientRect()
          const preferred = trackIdAtClientY({
            clientY: event.clientY,
            contentTop: bounds.top,
            scrollTop: viewport.scrollTop,
            tracks: displayTracksRef.current,
            kind: primaryDragKind,
          })
          dragPreferredTrackIdRef.current = preferred
          setDragPreferredTrackId(preferred)
        }
      }
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
  }, [clipDrag, commitDrag, pixelsPerSecond, primaryDragKind])

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
      setViewportWidth(Math.max(0, viewport.clientWidth - LABEL_WIDTH))
    })
    resizeObserver.observe(viewport)
    setViewportWidth(Math.max(0, viewport.clientWidth - LABEL_WIDTH))
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!isPlaying) return
    const viewport = scrollRef.current
    if (!viewport) return
    const playheadX = msToPx(playheadMs, pixelsPerSecond) + LABEL_WIDTH
    const inset = 80
    if (
      playheadX < viewport.scrollLeft + inset + LABEL_WIDTH ||
      playheadX > viewport.scrollLeft + viewport.clientWidth - inset
    ) {
      viewport.scrollTo({
        left: Math.max(
          0,
          playheadX - viewport.clientWidth / 2,
        ),
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

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const originY = event.clientY
      const originHeight = timelineHeightPx

      const onMove = (moveEvent: PointerEvent) => {
        // Dragging the top edge up grows the panel; down shrinks it.
        const next = originHeight + (originY - moveEvent.clientY)
        setTimelineHeightPx(clampTimelineHeight(next))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [setTimelineHeightPx, timelineHeightPx],
  )

  useEffect(() => {
    const fitToViewport = () => {
      const max = getTimelineHeightMax()
      if (timelineHeightPx > max) {
        setTimelineHeightPx(max)
      }
    }
    fitToViewport()
    window.addEventListener('resize', fitToViewport)
    return () => window.removeEventListener('resize', fitToViewport)
  }, [setTimelineHeightPx, timelineHeightPx])

  const heightMax = getTimelineHeightMax()

  return (
    <section
      className="relative flex w-full min-w-0 shrink-0 select-none flex-col overflow-hidden border-t border-fb-border bg-fb-surface"
      style={{ height: clampTimelineHeight(timelineHeightPx) }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline"
        aria-valuemin={TIMELINE_MIN_HEIGHT}
        aria-valuemax={heightMax}
        aria-valuenow={clampTimelineHeight(timelineHeightPx)}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setTimelineHeightPx(clampTimelineHeight(timelineHeightPx + 24))
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setTimelineHeightPx(clampTimelineHeight(timelineHeightPx - 24))
          }
        }}
        className="group absolute inset-x-0 top-0 z-20 flex h-2 cursor-row-resize items-start justify-center"
      >
        <span className="mt-0.5 h-1 w-10 rounded-full bg-fb-border-strong opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-fb-border bg-fb-panel px-3 pt-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Timeline
        </h2>
        {selectedClipId && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => unlinkSelectedClip()}
              disabled={!selectedIsLinked}
              aria-label="Unlink clip"
              title="Unlink"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-fb-border px-2 text-[11px] text-fb-muted disabled:cursor-not-allowed disabled:opacity-35 hover:enabled:bg-white/[0.06] hover:enabled:text-fb-text"
            >
              <Link2Off size={12} strokeWidth={1.75} />
              Unlink
            </button>
            <button
              type="button"
              onClick={() => linkSelectedClip()}
              disabled={!canLinkSelected}
              aria-label="Link clip"
              title="Link"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-fb-border px-2 text-[11px] text-fb-muted disabled:cursor-not-allowed disabled:opacity-35 hover:enabled:bg-white/[0.06] hover:enabled:text-fb-text"
            >
              <Link2 size={12} strokeWidth={1.75} />
              Link
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ZoomOut
            size={12}
            strokeWidth={1.75}
            className="shrink-0 text-fb-muted"
            aria-hidden
          />
          <input
            type="range"
            min={20}
            max={240}
            step={10}
            value={pixelsPerSecond}
            onChange={(event) =>
              setPixelsPerSecond(Number(event.target.value))
            }
            aria-label="Timeline zoom"
            title={`${pixelsPerSecond}px/s`}
            className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-fb-border accent-fb-accent [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fb-text"
          />
          <ZoomIn
            size={12}
            strokeWidth={1.75}
            className="shrink-0 text-fb-muted"
            aria-hidden
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
        onClick={() => selectClip(null)}
        onScroll={(event) =>
          setTimelineScrollLeft(event.currentTarget.scrollLeft)
        }
      >
        <div
          ref={tracksContentRef}
          className="relative flex min-w-full"
          style={{
            width: LABEL_WIDTH + contentWidth,
            minHeight: `max(100%, ${RULER_HEIGHT + displayTracks.length * TRACK_HEIGHT}px)`,
          }}
        >
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-fb-border bg-fb-panel"
            style={{ width: LABEL_WIDTH }}
          >
            <div
              className="sticky top-0 z-30 border-b border-fb-border bg-fb-ruler"
              style={{ height: RULER_HEIGHT }}
            />
            {displayTracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-2 border-b border-fb-border bg-fb-panel px-2 text-[11px] font-medium text-fb-muted"
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
            className="relative min-w-0 flex-1 bg-fb-surface"
            style={{ minWidth: contentWidth }}
          >
            <div
              className="sticky top-0 z-30 cursor-ew-resize border-b border-fb-border bg-fb-ruler"
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

            {displayTracks.map((track) => (
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
                  .filter((clip) => {
                    const placement = placementByClipId?.get(clip.id)
                    if (placement) return placement.trackId === track.id
                    return clip.trackId === track.id
                  })
                  .map((clip) => {
                    const placement = placementByClipId?.get(clip.id)
                    return (
                      <TimelineClipBlock
                        key={clip.id}
                        clip={clip}
                        track={track}
                        pixelsPerSecond={pixelsPerSecond}
                        selected={clip.id === selectedClipId}
                        linkedHighlight={
                          clip.id !== selectedClipId &&
                          Boolean(selectedLinkGroupId) &&
                          clip.linkGroupId === selectedLinkGroupId
                        }
                        dragDeltaMs={
                          clipDrag &&
                          (clipDrag.clipId === clip.id ||
                            (Boolean(clipDrag.linkGroupId) &&
                              clip.linkGroupId === clipDrag.linkGroupId))
                            ? dragDeltaMs
                            : 0
                        }
                        previewTimelineStartMs={placement?.timelineStartMs}
                        onSelect={() => selectClip(clip.id)}
                        onPointerDownMove={(clientX, clientY) => {
                          dragDeltaMsRef.current = 0
                          dragPreferredTrackIdRef.current = track.id
                          setDragDeltaMs(0)
                          setDragPreferredTrackId(track.id)
                          setClipDrag({
                            clipId: clip.id,
                            mode: 'move',
                            originClientX: clientX,
                            originClientY: clientY,
                            originTrackId: track.id,
                            originTimelineStartMs: clip.timelineStartMs,
                            originSourceInMs: clip.sourceInMs,
                            originSourceOutMs: clip.sourceOutMs,
                            linkGroupId: clip.linkGroupId,
                          })
                        }}
                        onPointerDownTrim={(edge, clientX) => {
                          dragDeltaMsRef.current = 0
                          dragPreferredTrackIdRef.current = undefined
                          setDragDeltaMs(0)
                          setDragPreferredTrackId(undefined)
                          setClipDrag({
                            clipId: clip.id,
                            mode: edge,
                            originClientX: clientX,
                            originClientY: 0,
                            originTrackId: track.id,
                            originTimelineStartMs: clip.timelineStartMs,
                            originSourceInMs: clip.sourceInMs,
                            originSourceOutMs: clip.sourceOutMs,
                            linkGroupId: clip.linkGroupId,
                          })
                        }}
                      />
                    )
                  })}
              </div>
            ))}

            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-fb-playhead/80"
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
