import { Camera, Film, Link2, Link2Off, MousePointer2, Music2, Redo2, Scissors, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type DragEvent as ReactDragEvent,
} from 'react'
import { AudioWaveform } from '@/components/timeline/AudioWaveform'
import {
  canLinkClipSelection,
  canUnlinkClipSelection,
  getClipPlaybackRange,
  planClipMove,
  planMediaDrop,
  type ClipMovePlan,
} from '@/features/editor/operations'
import { resolvePlaybackAt } from '@/features/editor/playback'
import {
  getMediaSourceById,
  getSortedTracks,
  getTimelineDurationMs,
} from '@/features/editor/project'
import { useEditorHistory, useEditorStore } from '@/stores/editor-store'
import {
  getFilmstripFrame,
  hasFilmstripFrame,
  setFilmstripFrame,
} from '@/lib/media/filmstrip-cache'
import { getObjectUrl } from '@/lib/media/object-urls'
import { importLocalMediaFile } from '@/lib/media/import'
import {
  draggingMediaSourceId,
  draggingMediaSourceIds,
  endMediaDrag,
  isLibraryMediaDrag,
  libraryMediaIdsFromDrop,
} from '@/lib/media/media-drag'
import type { Clip, Track } from '@/types/timeline'
import { downloadVideoFrame } from '@/lib/media/save-frame'
import { clamp, formatFrameClock, formatSignedFrameClock, formatTimecode, FRAME_DURATION_MS, msToSeconds, snapToFrameMs } from '@/utils/time'

const TRACK_HEIGHT = 104
const RULER_HEIGHT = 28
const LABEL_WIDTH = 88
/** Keeps the clip border/selection ring from clipping under the track titles. */
const TIMELINE_X_INSET = 2
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

function magneticMoveStartMs(args: {
  rawStartMs: number
  durationMs: number
  pixelsPerSecond: number
  playheadMs: number
  clips: Clip[]
  ignoreIds: Set<string>
}): number {
  const thresholdMs = Math.max(1, pxToMs(12, args.pixelsPerSecond))
  let best = snapToFrameMs(Math.max(0, args.rawStartMs))
  let bestDistance = thresholdMs + 1

  const consider = (point: number) => {
    const next = Math.max(0, Math.round(point))
    const distance = Math.abs(next - args.rawStartMs)
    if (distance <= thresholdMs && distance < bestDistance) {
      best = next
      bestDistance = distance
    }
  }

  consider(0)
  consider(args.playheadMs)
  consider(args.playheadMs - args.durationMs)
  for (const clip of args.clips) {
    if (args.ignoreIds.has(clip.id)) continue
    const endMs =
      clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs)
    consider(clip.timelineStartMs)
    consider(endMs)
    consider(clip.timelineStartMs - args.durationMs)
    consider(endMs - args.durationMs)
  }

  return best
}


/** Hit-test a track row under the pointer in the vertically scrolling body. */
function trackIdAtClientY(args: {
  clientY: number
  bodyTop: number
  scrollTop: number
  tracks: Track[]
  kind?: Track['kind']
}): string | undefined {
  const y = args.clientY - args.bodyTop + args.scrollTop - RULER_HEIGHT
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


const FILMSTRIP_HEIGHT = 70

/**
 * Premiere/Resolve-style strip: fixed-aspect thumbnails locked to source time.
 * Zoom shows more tiles; trimming slides the same tiles instead of stretching them.
 */
function VideoFilmstrip({
  src,
  sourceInMs,
  sourceOutMs,
  mediaDurationMs,
  pixelsPerSecond,
  aspect,
}: {
  src: string
  sourceInMs: number
  sourceOutMs: number
  mediaDurationMs: number
  pixelsPerSecond: number
  aspect: number
}) {
  const [, setCacheVersion] = useState(0)
  const safeAspect = Number.isFinite(aspect) && aspect > 0.2 ? aspect : 16 / 9
  const idealThumbWidth = Math.max(36, Math.round(FILMSTRIP_HEIGHT * safeAspect))
  const clipPx = Math.max(
    idealThumbWidth,
    msToPx(Math.max(1, sourceOutMs - sourceInMs), pixelsPerSecond),
  )
  const thumbWidth =
    clipPx / idealThumbWidth > 48
      ? Math.ceil(clipPx / 48)
      : idealThumbWidth
  const slotMs = Math.max(
    FRAME_DURATION_MS,
    pxToMs(thumbWidth, pixelsPerSecond),
  )
  const durationMs = Math.max(slotMs, mediaDurationMs)
  const startSlot = Math.max(0, Math.floor(sourceInMs / slotMs))
  const endSlot = Math.min(
    Math.ceil(durationMs / slotMs),
    Math.ceil(Math.max(sourceInMs, sourceOutMs) / slotMs) + 1,
  )
  const slots: number[] = []
  for (let slot = startSlot; slot <= endSlot; slot += 1) slots.push(slot)
  const offsetPx = msToPx(sourceInMs, pixelsPerSecond) - startSlot * thumbWidth

  useEffect(() => {
    const missing: number[] = []
    for (let slot = startSlot; slot <= endSlot; slot += 1) {
      const timeMs = Math.min(durationMs - 1, Math.round(slot * slotMs + slotMs / 2))
      if (!hasFilmstripFrame(src, timeMs)) missing.push(slot)
    }
    if (missing.length === 0) return

    let cancelled = false
    const video = document.createElement('video')
    video.src = src
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.crossOrigin = 'anonymous'

    const capture = async () => {
      const canvas = document.createElement('canvas')
      const height = 180
      const width = Math.max(1, Math.round(height * safeAspect))
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      for (const slot of missing) {
        if (cancelled) return
        const timeMs = Math.min(
          durationMs - 1,
          Math.round(slot * slotMs + slotMs / 2),
        )
        if (hasFilmstripFrame(src, timeMs)) continue
        await new Promise<void>((resolve) => {
          const finish = () => resolve()
          video.onseeked = finish
          video.onerror = finish
          const seconds = Math.min(
            Math.max(0, (video.duration || durationMs / 1000) - 0.05),
            timeMs / 1000,
          )
          if (Math.abs(video.currentTime - seconds) < 0.02) {
            finish()
            return
          }
          video.currentTime = seconds
        })
        if (cancelled || hasFilmstripFrame(src, timeMs)) continue
        context.drawImage(video, 0, 0, width, height)
        setFilmstripFrame(src, timeMs, canvas.toDataURL('image/jpeg', 0.86))
        setCacheVersion((version) => version + 1)
      }
    }

    const start = () => void capture()
    if (video.readyState >= 1) start()
    else video.onloadedmetadata = start
    video.onerror = () => {
      if (!cancelled) setCacheVersion((version) => version + 1)
    }

    return () => {
      cancelled = true
      video.onloadedmetadata = null
      video.onseeked = null
      video.removeAttribute('src')
      video.load()
    }
  }, [durationMs, endSlot, safeAspect, slotMs, src, startSlot])

  return (
    <div className="pointer-events-none h-full w-full overflow-clip" aria-hidden>
      <div className="flex h-full" style={{ marginLeft: -offsetPx }}>
        {slots.map((slot) => {
          const timeMs = Math.min(
            durationMs - 1,
            Math.round(slot * slotMs + slotMs / 2),
          )
          const frame = getFilmstripFrame(src, timeMs)
          return (
            <div
              key={slot}
              className="h-full shrink-0 bg-[#1a2228]"
              style={{ width: thumbWidth }}
            >
              {frame ? (
                <img
                  src={frame}
                  alt=""
                  draggable={false}
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
          )
        })}
      </div>
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
  isMoving,
  blade,
  onSelect,
  onPointerDownMove,
  onPointerDownTrim,
  onBlade,
}: {
  clip: Clip
  track: Track
  pixelsPerSecond: number
  selected: boolean
  linkedHighlight: boolean
  dragDeltaMs: number
  /** When set (live move plan), overrides timeline start instead of delta. */
  previewTimelineStartMs?: number
  isMoving: boolean
  blade: boolean
  onSelect: (additive: boolean) => void
  onPointerDownMove: (clientX: number, clientY: number) => void
  onPointerDownTrim: (edge: 'trim-in' | 'trim-out', clientX: number) => void
  onBlade: (clientX: number) => void
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
  const trimmingEdge =
    isDragParticipant && drag && (drag.mode === 'trim-in' || drag.mode === 'trim-out')
      ? drag.mode
      : null
  const isPrimaryTrim = trimmingEdge != null && drag?.clipId === clip.id
  const trimDeltaMs =
    trimmingEdge === 'trim-in'
      ? sourceInMs - (drag?.originSourceInMs ?? sourceInMs)
      : trimmingEdge === 'trim-out'
        ? sourceOutMs - (drag?.originSourceOutMs ?? sourceOutMs)
        : 0
  const trimEdgeMs =
    trimmingEdge === 'trim-in'
      ? timelineStartMs
      : timelineStartMs + durationMs

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${title} on ${track.name}`}
      aria-pressed={selected}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onSelect(event.metaKey || event.ctrlKey)
        }
      }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(event.metaKey || event.ctrlKey)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement
        if (!blade && target.closest('[data-trim]')) return
        event.stopPropagation()
        if (blade) {
          event.preventDefault()
          onBlade(event.clientX)
          return
        }
        onPointerDownMove(event.clientX, event.clientY)
      }}
      className={`absolute top-1.5 z-0 flex h-[calc(100%-12px)] flex-col rounded-md border-2 ${
        isMoving
          ? 'z-10 cursor-grabbing border-dashed opacity-90 shadow-[0_10px_28px_rgba(0,0,0,0.45)]'
          : blade
            ? 'cursor-crosshair'
            : 'cursor-default'
      } ${isVideo ? 'bg-[#151c22]' : 'bg-[#13241f]'} ${
        trimmingEdge
          ? 'z-10 border-[#7dffb2]'
          : selected
            ? 'border-fb-accent'
            : linkedHighlight
              ? 'border-fb-accent/70'
              : isVideo
                ? 'border-[#2a3a45]'
                : 'border-[#1f3d34]'
      }`}
      style={{ left: TIMELINE_X_INSET + left, width }}
    >
      {isPrimaryTrim && (
        <div
          className={`pointer-events-none absolute bottom-full z-50 mb-2 min-w-[78px] rounded-lg bg-black/85 px-2 py-1 text-right font-mono text-[11px] leading-tight text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)] ${
            trimmingEdge === 'trim-out' ? 'right-0' : 'left-0'
          }`}
        >
          <div>{formatSignedFrameClock(trimDeltaMs)}</div>
          <div className="text-white/75">{formatFrameClock(trimEdgeMs)}</div>
        </div>
      )}
      <div className="relative flex h-[22px] shrink-0 items-center overflow-clip rounded-t-[4px] bg-[#243038] px-2">
        <span className="truncate text-[10px] font-medium leading-none text-white/90">
          {title}
        </span>
      </div>

      <div
        className={`relative min-h-0 flex-1 overflow-clip rounded-b-[4px] ${
          isVideo ? 'bg-[#1a2228]' : 'bg-[#16352c]'
        }`}
      >
        {isVideo && objectUrl && media ? (
          <VideoFilmstrip
            src={objectUrl}
            sourceInMs={sourceInMs}
            sourceOutMs={sourceOutMs}
            mediaDurationMs={media.durationMs}
            pixelsPerSecond={pixelsPerSecond}
            aspect={
              media.width && media.height ? media.width / media.height : 16 / 9
            }
          />
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

      {trimmingEdge === 'trim-in' && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-0.5 bg-[#7dffb2] shadow-[0_0_8px_rgba(125,255,178,0.85)]" />
      )}
      {trimmingEdge === 'trim-out' && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-0.5 bg-[#7dffb2] shadow-[0_0_8px_rgba(125,255,178,0.85)]" />
      )}

      <button
        type="button"
        data-trim="in"
        aria-label="Trim clip start"
        className={`absolute inset-y-0 left-0 z-[1] w-2 cursor-ew-resize ${
          trimmingEdge === 'trim-in' ? 'bg-[#7dffb2]/25' : 'bg-transparent hover:bg-white/25'
        }`}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          if (blade) {
            onBlade(event.clientX)
            return
          }
          onSelect(event.metaKey || event.ctrlKey)
          onPointerDownTrim('trim-in', event.clientX)
        }}
      />
      <button
        type="button"
        data-trim="out"
        aria-label="Trim clip end"
        className={`absolute inset-y-0 right-0 z-[1] w-2 cursor-ew-resize ${
          trimmingEdge === 'trim-out' ? 'bg-[#7dffb2]/25' : 'bg-transparent hover:bg-white/25'
        }`}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          if (blade) {
            onBlade(event.clientX)
            return
          }
          onSelect(event.metaKey || event.ctrlKey)
          onPointerDownTrim('trim-out', event.clientX)
        }}
      />
    </div>
  )
}

function SaveFrameButton({
  saving,
  onSave,
}: {
  saving: boolean
  onSave: () => void
}) {
  const playheadMs = useEditorStore((state) => state.ui.playheadMs)
  const document = useEditorStore((state) => state.document)
  const resolution = resolvePlaybackAt(document, playheadMs)
  const media =
    resolution.status === 'clip'
      ? getMediaSourceById(document, resolution.mediaSourceId)
      : null
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={!media?.hasVideo || saving}
      aria-label="Save current frame"
      title="Save current frame"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fb-muted hover:enabled:bg-white/[0.06] hover:enabled:text-fb-text disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Camera size={15} strokeWidth={1.75} />
    </button>
  )
}

function TimelinePlayhead({
  viewportRef,
}: {
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const playheadMs = useEditorStore((state) => state.ui.playheadMs)
  const isPlaying = useEditorStore((state) => state.ui.isPlaying)
  const pixelsPerSecond = useEditorStore((state) => state.ui.pixelsPerSecond)
  const playheadLeft = TIMELINE_X_INSET + msToPx(playheadMs, pixelsPerSecond)

  useEffect(() => {
    if (!isPlaying) return
    const viewport = viewportRef.current
    if (!viewport) return
    const playheadX =
      LABEL_WIDTH + TIMELINE_X_INSET + msToPx(playheadMs, pixelsPerSecond)
    const inset = 80
    if (
      playheadX < viewport.scrollLeft + LABEL_WIDTH + inset ||
      playheadX > viewport.scrollLeft + viewport.clientWidth - inset
    ) {
      viewport.scrollTo({
        left: Math.max(
          0,
          playheadX - (viewport.clientWidth + LABEL_WIDTH) / 2,
        ),
        behavior: 'auto',
      })
    }
  }, [isPlaying, pixelsPerSecond, playheadMs, viewportRef])

  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-fb-playhead/80"
      style={{ left: LABEL_WIDTH + playheadLeft }}
      aria-hidden
    >
      <div className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-fb-playhead shadow-[0_0_8px_rgba(255,255,255,0.45)]" />
    </div>
  )
}

export function TimelinePanel() {
  const document = useEditorStore((state) => state.document)
  const pixelsPerSecond = useEditorStore((state) => state.ui.pixelsPerSecond)
  const timelineScrollLeft = useEditorStore(
    (state) => state.ui.timelineScrollLeft,
  )
  const timelineHeightPx = useEditorStore((state) => state.ui.timelineHeightPx)
  const selectedClipIds = useEditorStore((state) => state.ui.selectedClipIds)
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
  const linkSelectedClips = useEditorStore((state) => state.linkSelectedClips)
  const unlinkSelectedClips = useEditorStore(
    (state) => state.unlinkSelectedClips,
  )
  const splitClipsAt = useEditorStore((state) => state.splitClipsAt)
  const pause = useEditorStore((state) => state.pause)
  const { undo, redo, canUndo, canRedo } = useEditorHistory()
  const addClip = useEditorStore((state) => state.addClip)
  const registerMediaSource = useEditorStore((state) => state.registerMediaSource)
  const setImportError = useEditorStore((state) => state.setImportError)
  const setImportStatus = useEditorStore((state) => state.setImportStatus)

  /** Single scroller for both axes; ruler sticks to top, labels stick to left. */
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const tracksContentRef = useRef<HTMLDivElement>(null)
  const dragDeltaMsRef = useRef(0)
  const dragGrabOffsetMsRef = useRef(0)
  const clipDragPointerRef = useRef<{ x: number; y: number } | null>(null)
  const dragPreferredTrackIdRef = useRef<string | undefined>(undefined)
  const isScrubbingRef = useRef(false)
  const panRef = useRef<{
    originClientX: number
    originClientY: number
    originScrollLeft: number
    originScrollTop: number
    seekClientX: number
    moved: boolean
  } | null>(null)
  const restoredScrollRef = useRef(false)
  const [dragDeltaMs, setDragDeltaMs] = useState(0)
  const [dragPreferredTrackId, setDragPreferredTrackId] = useState<
    string | undefined
  >(undefined)
  const [isHandDragging, setIsHandDragging] = useState(false)
  const suppressClickRef = useRef(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [hoverFrameMs, setHoverFrameMs] = useState<number | null>(null)
  const [timelineTool, setTimelineTool] = useState<'select' | 'cut'>('select')
  const [savingFrame, setSavingFrame] = useState(false)
  const [mediaDrop, setMediaDrop] = useState<{
    mediaSourceIds: string[]
    timelineStartMs: number
    trackId?: string
    fileDrop: boolean
  } | null>(null)
  const dropPlanSeedRef = useRef<Track[] | undefined>(undefined)

  const tracks = getSortedTracks(document)
  const durationMs = getTimelineDurationMs(document)
  const selectedClips = selectedClipIds
    .map((id) => document.clips.find((clip) => clip.id === id))
    .filter((clip): clip is Clip => clip != null)
  const selectedLinkGroupIds = new Set(
    selectedClips
      .map((clip) => clip.linkGroupId)
      .filter((id): id is string => Boolean(id)),
  )
  const canUnlinkSelected = canUnlinkClipSelection(document, selectedClipIds)
  const canLinkSelected = canLinkClipSelection(document, selectedClipIds)
  // Always fill the visible tracks area, and leave room past the last clip so
  // the ruler background and track lines cover every tick you can scroll to.
  const contentWidth =
    Math.max(
      800,
      viewportWidth,
      msToPx(durationMs, pixelsPerSecond) + 160,
    ) + TIMELINE_X_INSET

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

  const dropPlan = useMemo(() => {
    const ids = mediaDrop?.mediaSourceIds ?? []
    if (ids.length === 0) {
      dropPlanSeedRef.current = undefined
      return null
    }

    let working = document
    let seedTracks = dropPlanSeedRef.current
    let startMs = mediaDrop!.timelineStartMs
    let trackId = mediaDrop!.trackId
    const placements: Array<{
      role: 'video' | 'audio'
      trackId: string
      timelineStartMs: number
      durationMs: number
    }> = []

    for (const mediaSourceId of ids) {
      const plan = planMediaDrop({
        document: working,
        mediaSourceId,
        timelineStartMs: startMs,
        trackId,
        seedTracks,
      })
      if ('error' in plan) break
      seedTracks = plan.tracks
      const follow =
        plan.placements.find((item) => item.trackId === trackId) ??
        plan.placements[0]
      if (!follow) break
      placements.push(...plan.placements)
      const placedClips = plan.placements.map((item, index) => ({
        id: `drop-${mediaSourceId}-${index}`,
        mediaSourceId,
        trackId: item.trackId,
        timelineStartMs: item.timelineStartMs,
        sourceInMs: 0,
        sourceOutMs: item.durationMs,
      }))
      working = {
        ...working,
        tracks: plan.tracks,
        clips: [...working.clips, ...placedClips],
      }
      startMs = follow.timelineStartMs + follow.durationMs
      trackId = follow.trackId
    }

    if (placements.length === 0) return null
    dropPlanSeedRef.current = seedTracks
    return { tracks: working.tracks, placements }
  }, [document, mediaDrop])

  const displayTracks = useMemo(() => {
    const overlayTracks = movePlan?.tracks ?? dropPlan?.tracks
    if (!overlayTracks) return tracks
    return getSortedTracks({ ...document, tracks: overlayTracks })
  }, [document, dropPlan, movePlan, tracks])

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
      const viewport = bodyScrollRef.current
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const x =
        clientX -
        bounds.left +
        viewport.scrollLeft -
        LABEL_WIDTH -
        TIMELINE_X_INSET
      seekTo(clamp(pxToMs(x, pixelsPerSecond), 0, durationMs))
    },
    [durationMs, pixelsPerSecond, seekTo],
  )

  const frameAtClientX = useCallback(
    (clientX: number): number | null => {
      const viewport = bodyScrollRef.current
      if (!viewport) return null
      const bounds = viewport.getBoundingClientRect()
      const localX = clientX - bounds.left
      if (localX < LABEL_WIDTH) return null
      const x = localX + viewport.scrollLeft - LABEL_WIDTH - TIMELINE_X_INSET
      const maxMs = pxToMs(
        Math.max(0, contentWidth - TIMELINE_X_INSET),
        pixelsPerSecond,
      )
      return clamp(snapToFrameMs(pxToMs(x, pixelsPerSecond)), 0, maxMs)
    },
    [contentWidth, pixelsPerSecond],
  )

  const cutTimeAtClientX = useCallback(
    (clientX: number): number | null => {
      const frame = frameAtClientX(clientX)
      if (frame == null) return null
      const playhead = snapToFrameMs(useEditorStore.getState().ui.playheadMs)
      const threshold = Math.max(1, pxToMs(12, pixelsPerSecond))
      if (Math.abs(frame - playhead) <= threshold) return playhead
      return frame
    },
    [frameAtClientX, pixelsPerSecond],
  )

  const splitAtPlayhead = useCallback(() => {
    const time = snapToFrameMs(useEditorStore.getState().ui.playheadMs)
    const doc = useEditorStore.getState().document
    const selected = useEditorStore.getState().ui.selectedClipIds
    const under = doc.clips.filter((clip) => {
      const { timelineEndMs } = getClipPlaybackRange(clip)
      return time > clip.timelineStartMs && time < timelineEndMs
    })
    const chosen =
      selected.length > 0
        ? under.filter((clip) => selected.includes(clip.id))
        : under
    if (chosen.length === 0) return
    splitClipsAt(
      chosen.map((clip) => clip.id),
      time,
    )
  }, [splitClipsAt])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target != null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing) return

      const meta = event.metaKey || event.ctrlKey
      if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        splitAtPlayhead()
        return
      }
      if (meta || event.altKey) return
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        setTimelineTool('select')
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        setTimelineTool('cut')
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [splitAtPlayhead])

  const saveCurrentFrame = useCallback(async () => {
    const state = useEditorStore.getState()
    const time = snapToFrameMs(state.ui.playheadMs)
    const resolution = resolvePlaybackAt(state.document, time)
    if (resolution.status !== 'clip') return
    const media = getMediaSourceById(state.document, resolution.mediaSourceId)
    if (!media?.hasVideo) return

    const video = globalThis.document.querySelector(
      'video[aria-label="Timeline preview"]',
    )
    if (!(video instanceof HTMLVideoElement)) return

    if (state.ui.isPlaying) pause()
    video.pause()

    const safeName =
      state.document.name.replace(/[^\w\- ]+/g, '').trim() || 'frame'
    const filename = `${safeName} ${formatFrameClock(time).replaceAll(':', '-')}.png`

    setSavingFrame(true)
    try {
      const objectUrl = getObjectUrl(resolution.mediaSourceId)
      if (objectUrl && video.currentSrc !== objectUrl) {
        video.src = objectUrl
        await new Promise<void>((resolve, reject) => {
          const onReady = () => {
            video.removeEventListener('loadedmetadata', onReady)
            video.removeEventListener('error', onError)
            resolve()
          }
          const onError = () => {
            video.removeEventListener('loadedmetadata', onReady)
            video.removeEventListener('error', onError)
            reject(new Error('Could not read the current frame.'))
          }
          video.addEventListener('loadedmetadata', onReady)
          video.addEventListener('error', onError)
        })
      }
      await downloadVideoFrame(
        video,
        msToSeconds(resolution.sourceTimeMs),
        filename,
      )
    } catch {
      useEditorStore.getState().setPlaybackError('Could not save the current frame.')
    } finally {
      setSavingFrame(false)
    }
  }, [pause])

  const timelineDropTarget = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = bodyScrollRef.current
      if (!viewport) return null
      const bounds = viewport.getBoundingClientRect()
      const localX = clientX - bounds.left
      if (localX < LABEL_WIDTH) return null
      const x = localX + viewport.scrollLeft - LABEL_WIDTH - TIMELINE_X_INSET
      const maxMs = pxToMs(
        Math.max(0, contentWidth - TIMELINE_X_INSET),
        pixelsPerSecond,
      )
      const pointerMs = clamp(pxToMs(Math.max(0, x), pixelsPerSecond), 0, maxMs)
      const mediaSourceId = draggingMediaSourceId()
      const source = mediaSourceId
        ? useEditorStore
            .getState()
            .document.mediaSources.find((item) => item.id === mediaSourceId)
        : undefined
      const durationMs = source?.durationMs ?? 0
      const doc = useEditorStore.getState().document
      const kind =
        source && source.hasVideo && !source.hasAudio
          ? 'video'
          : source && source.hasAudio && !source.hasVideo
            ? 'audio'
            : undefined
      const trackId = trackIdAtClientY({
        clientY,
        bodyTop: bounds.top,
        scrollTop: viewport.scrollTop,
        tracks: displayTracksRef.current,
        kind,
      })
      const covering = doc.clips.find((clip) => {
        if (trackId && clip.trackId !== trackId) return false
        const clipEnd =
          clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs)
        return pointerMs >= clip.timelineStartMs && pointerMs < clipEnd
      })
      // Over an existing clip, begin just left of that clip's start so the
      // strip is not parked at the pointer in the middle of it.
      const leadMs = pxToMs(16, pixelsPerSecond)
      const rawStartMs = covering
        ? Math.max(0, covering.timelineStartMs - leadMs)
        : pointerMs
      const timelineStartMs = magneticMoveStartMs({
        rawStartMs,
        durationMs: covering ? 0 : durationMs,
        pixelsPerSecond,
        playheadMs: useEditorStore.getState().ui.playheadMs,
        clips: doc.clips,
        ignoreIds: new Set(covering ? [covering.id] : []),
      })
      return { timelineStartMs, trackId, mediaSourceIds: draggingMediaSourceIds() }
    },
    [contentWidth, pixelsPerSecond],
  )

  const onTimelineDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const fileDrop = event.dataTransfer.types.includes('Files')
      if (!isLibraryMediaDrag(event.dataTransfer) && !fileDrop) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      const target = timelineDropTarget(event.clientX, event.clientY)
      if (!target) {
        setMediaDrop(null)
        return
      }
      setHoverFrameMs(null)
      setMediaDrop((current) => {
        const mediaSourceIds = target.mediaSourceIds
        const sameIds =
          current != null &&
          current.mediaSourceIds.length === mediaSourceIds.length &&
          current.mediaSourceIds.every((id, index) => id === mediaSourceIds[index])
        if (
          current &&
          sameIds &&
          current.timelineStartMs === target.timelineStartMs &&
          current.trackId === target.trackId &&
          current.fileDrop === (mediaSourceIds.length === 0)
        ) {
          return current
        }
        return {
          mediaSourceIds,
          timelineStartMs: target.timelineStartMs,
          trackId: target.trackId,
          fileDrop: mediaSourceIds.length === 0,
        }
      })
    },
    [timelineDropTarget],
  )

  const onTimelineDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const fileDrop = event.dataTransfer.types.includes('Files')
      const libraryDrop = isLibraryMediaDrag(event.dataTransfer)
      if (!libraryDrop && !fileDrop) return
      event.preventDefault()
      const target = timelineDropTarget(event.clientX, event.clientY)
      setMediaDrop(null)
      dropPlanSeedRef.current = undefined
      if (!target) {
        endMediaDrag()
        return
      }

      if (libraryDrop) {
        const mediaSourceIds = libraryMediaIdsFromDrop(event.dataTransfer)
        endMediaDrag()
        let startMs = target.timelineStartMs
        let trackId = target.trackId
        for (const mediaSourceId of mediaSourceIds) {
          const before = new Set(
            useEditorStore.getState().document.clips.map((clip) => clip.id),
          )
          addClip(mediaSourceId, startMs, trackId)
          const added = useEditorStore
            .getState()
            .document.clips.filter((clip) => !before.has(clip.id))
          const follow =
            added.find((clip) => clip.trackId === trackId) ?? added[0]
          if (!follow) continue
          startMs =
            follow.timelineStartMs + (follow.sourceOutMs - follow.sourceInMs)
          trackId = follow.trackId
        }
        return
      }

      const files = Array.from(event.dataTransfer.files)
      endMediaDrag()
      if (files.length === 0) return

      void (async () => {
        setImportStatus('importing')
        setImportError(null)
        let startMs = target.timelineStartMs
        for (const file of files) {
          const result = await importLocalMediaFile(file)
          if (!result.ok) {
            setImportError(result.error)
            continue
          }
          registerMediaSource(result.source)
          addClip(result.source.id, startMs, target.trackId)
          startMs += result.source.durationMs
        }
        setImportStatus('idle')
      })()
    },
    [addClip, registerMediaSource, setImportError, setImportStatus, timelineDropTarget],
  )

  useEffect(() => {
    if (!mediaDrop) return
    const clear = () => {
      setMediaDrop(null)
      dropPlanSeedRef.current = undefined
    }
    window.addEventListener('dragend', clear)
    return () => window.removeEventListener('dragend', clear)
  }, [mediaDrop])

  const zoomAtClientX = useCallback(
    (clientX: number, direction: 1 | -1) => {
      const viewport = bodyScrollRef.current
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const cursorOffset = clientX - bounds.left
      const timeAtCursorMs = pxToMs(
        viewport.scrollLeft + cursorOffset - LABEL_WIDTH - TIMELINE_X_INSET,
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
          LABEL_WIDTH +
          TIMELINE_X_INSET
        viewport.scrollLeft = Math.max(0, nextLeft)
      })
    },
    [pixelsPerSecond, setPixelsPerSecond],
  )

  useEffect(() => {
    const viewport = bodyScrollRef.current
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
    // Stay inside the painted content so ticks can't widen the scroll area
    // past the ruler background and track lines.
    const rulerEndMs = pxToMs(
      Math.max(0, contentWidth - TIMELINE_X_INSET),
      pixelsPerSecond,
    )
    for (let ms = 0; ms <= rulerEndMs; ms += stepMs) {
      marks.push({ ms, major: ms % (stepMs * 2) === 0 || stepMs >= 2000 })
    }
    return marks
  }, [contentWidth, pixelsPerSecond])

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

    const applyMove = (clientX: number, clientY: number) => {
      const drag = useEditorStore.getState().clipDrag
      if (!drag || drag.mode !== 'move') return
      const viewport = bodyScrollRef.current
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const localX = Math.max(LABEL_WIDTH, clientX - bounds.left)
      const x = localX + viewport.scrollLeft - LABEL_WIDTH - TIMELINE_X_INSET
      const maxMs = pxToMs(
        Math.max(0, viewport.scrollWidth - LABEL_WIDTH - TIMELINE_X_INSET),
        pixelsPerSecond,
      )
      const underMs = clamp(pxToMs(Math.max(0, x), pixelsPerSecond), 0, maxMs)
      const rawStart = underMs - dragGrabOffsetMsRef.current
      const doc = useEditorStore.getState().document
      const moving = doc.clips.filter(
        (clip) =>
          clip.id === drag.clipId ||
          (Boolean(drag.linkGroupId) && clip.linkGroupId === drag.linkGroupId),
      )
      const primary = moving.find((clip) => clip.id === drag.clipId)
      const durationMs = primary
        ? primary.sourceOutMs - primary.sourceInMs
        : 0
      const snapped = magneticMoveStartMs({
        rawStartMs: rawStart,
        durationMs,
        pixelsPerSecond,
        playheadMs: useEditorStore.getState().ui.playheadMs,
        clips: doc.clips,
        ignoreIds: new Set(moving.map((clip) => clip.id)),
      })
      const delta = snapped - drag.originTimelineStartMs
      dragDeltaMsRef.current = delta
      setDragDeltaMs(delta)

      if (primaryDragKind) {
        const preferred = trackIdAtClientY({
          clientY,
          bodyTop: bounds.top,
          scrollTop: viewport.scrollTop,
          tracks: displayTracksRef.current,
          kind: primaryDragKind,
        })
        dragPreferredTrackIdRef.current = preferred
        setDragPreferredTrackId(preferred)
      }
    }

    const onMove = (event: PointerEvent) => {
      const drag = useEditorStore.getState().clipDrag
      if (!drag) return
      if (drag.mode !== 'move') {
        const rawDelta = pxToMs(event.clientX - drag.originClientX, pixelsPerSecond)
        const originDuration = drag.originSourceOutMs - drag.originSourceInMs
        const rawEdge =
          drag.mode === 'trim-in'
            ? drag.originTimelineStartMs + rawDelta
            : drag.originTimelineStartMs + originDuration + rawDelta
        const doc = useEditorStore.getState().document
        const movingIds = new Set(
          doc.clips
            .filter(
              (clip) =>
                clip.id === drag.clipId ||
                (Boolean(drag.linkGroupId) &&
                  clip.linkGroupId === drag.linkGroupId),
            )
            .map((clip) => clip.id),
        )
        const snappedEdge = magneticMoveStartMs({
          rawStartMs: Math.max(0, rawEdge),
          durationMs: 0,
          pixelsPerSecond,
          playheadMs: useEditorStore.getState().ui.playheadMs,
          clips: doc.clips,
          ignoreIds: movingIds,
        })
        const delta =
          drag.mode === 'trim-in'
            ? snappedEdge - drag.originTimelineStartMs
            : snappedEdge - (drag.originTimelineStartMs + originDuration)
        dragDeltaMsRef.current = delta
        setDragDeltaMs(delta)
        return
      }
      clipDragPointerRef.current = { x: event.clientX, y: event.clientY }
      applyMove(event.clientX, event.clientY)
    }

    let frame = 0
    const tick = () => {
      if (clipDrag.mode !== 'move') return
      const pointer = clipDragPointerRef.current
      const viewport = bodyScrollRef.current
      if (pointer && viewport) {
        const bounds = viewport.getBoundingClientRect()
        const localX = pointer.x - bounds.left
        const localY = pointer.y - bounds.top
        const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        let scrolled = false
        if (localX > bounds.width - 64 && viewport.scrollLeft < maxLeft) {
          viewport.scrollLeft = Math.min(maxLeft, viewport.scrollLeft + 16)
          scrolled = true
        } else if (localX < LABEL_WIDTH + 64 && viewport.scrollLeft > 0) {
          viewport.scrollLeft = Math.max(0, viewport.scrollLeft - 16)
          scrolled = true
        }
        if (localY > bounds.height - 36 && viewport.scrollTop < maxTop) {
          viewport.scrollTop = Math.min(maxTop, viewport.scrollTop + 10)
          scrolled = true
        } else if (localY < RULER_HEIGHT + 28 && viewport.scrollTop > 0) {
          viewport.scrollTop = Math.max(0, viewport.scrollTop - 10)
          scrolled = true
        }
        if (scrolled) applyMove(pointer.x, pointer.y)
      }
      frame = window.requestAnimationFrame(tick)
    }
    if (clipDrag.mode === 'move') {
      frame = window.requestAnimationFrame(tick)
    }

    const onUp = () => {
      clipDragPointerRef.current = null
      commitDrag()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      clipDragPointerRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [clipDrag, commitDrag, pixelsPerSecond, primaryDragKind])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (isScrubbingRef.current) {
        seekFromClientX(event.clientX)
        return
      }

      const pan = panRef.current
      const body = bodyScrollRef.current
      if (!pan || !body) return

      const dx = event.clientX - pan.originClientX
      const dy = event.clientY - pan.originClientY
      if (!pan.moved && Math.hypot(dx, dy) > 4) {
        pan.moved = true
        setIsHandDragging(true)
        setHoverFrameMs(null)
      }
      if (!pan.moved) return

      const maxScrollLeft = Math.max(0, body.scrollWidth - body.clientWidth)
      const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
      body.scrollLeft = clamp(pan.originScrollLeft - dx, 0, maxScrollLeft)
      body.scrollTop = clamp(pan.originScrollTop - dy, 0, maxScrollTop)
      setTimelineScrollLeft(body.scrollLeft)
    }

    const onUp = () => {
      if (isScrubbingRef.current) {
        isScrubbingRef.current = false
        return
      }

      const pan = panRef.current
      if (!pan) return
      if (!pan.moved) {
        seekFromClientX(pan.seekClientX)
      } else {
        suppressClickRef.current = true
      }
      panRef.current = null
      setIsHandDragging(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [seekFromClientX, setTimelineScrollLeft])

  const isClipMoving = clipDrag?.mode === 'move'
  useEffect(() => {
    const handActive = isHandDragging || Boolean(isClipMoving)
    if (!handActive) return
    const previous = globalThis.document.body.style.cursor
    globalThis.document.body.style.cursor = 'grabbing'
    return () => {
      globalThis.document.body.style.cursor = previous
    }
  }, [isClipMoving, isHandDragging])

  useEffect(() => {
    const viewport = bodyScrollRef.current
    if (!viewport || restoredScrollRef.current) return
    viewport.scrollLeft = timelineScrollLeft
    restoredScrollRef.current = true
  }, [timelineScrollLeft])

  useEffect(() => {
    const viewport = bodyScrollRef.current
    if (!viewport) return
    const resizeObserver = new ResizeObserver(() => {
      setViewportWidth(Math.max(0, viewport.clientWidth - LABEL_WIDTH))
    })
    resizeObserver.observe(viewport)
    setViewportWidth(Math.max(0, viewport.clientWidth - LABEL_WIDTH))
    return () => resizeObserver.disconnect()
  }, [])

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
      if (selectedClipIds.length > 0) {
        event.preventDefault()
        for (const clipId of selectedClipIds) {
          removeClip(clipId)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [removeClip, selectedClipIds])

  const hoverPlayheadLeft =
    hoverFrameMs == null
      ? null
      : TIMELINE_X_INSET + msToPx(hoverFrameMs, pixelsPerSecond)

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
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTimelineTool('select')}
            aria-label="Select tool"
            aria-pressed={timelineTool === 'select'}
            title="Select (V)"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${
              timelineTool === 'select'
                ? 'bg-white/[0.12] text-fb-text'
                : 'text-fb-muted hover:bg-white/[0.06] hover:text-fb-text'
            }`}
          >
            <MousePointer2 size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setTimelineTool('cut')}
            aria-label="Cut tool"
            aria-pressed={timelineTool === 'cut'}
            title="Cut. Click a clip to split it (C). Ctrl+K or ⌘K splits at the playhead"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${
              timelineTool === 'cut'
                ? 'bg-white/[0.12] text-fb-text'
                : 'text-fb-muted hover:bg-white/[0.06] hover:text-fb-text'
            }`}
          >
            <Scissors size={15} strokeWidth={1.75} />
          </button>
          <span className="mx-1 h-4 w-px bg-fb-border" aria-hidden />
          <button
            type="button"
            onClick={() => undo()}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (⌘Z)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fb-muted hover:enabled:bg-white/[0.06] hover:enabled:text-fb-text disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Undo2 size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => redo()}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fb-muted hover:enabled:bg-white/[0.06] hover:enabled:text-fb-text disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Redo2 size={15} strokeWidth={1.75} />
          </button>
          <span className="mx-1 h-4 w-px bg-fb-border" aria-hidden />
          <button
            type="button"
            onClick={() => {
              if (canUnlinkSelected) unlinkSelectedClips()
              else linkSelectedClips()
            }}
            disabled={!canUnlinkSelected && !canLinkSelected}
            aria-label={canUnlinkSelected ? 'Unlink clips' : 'Link clips'}
            title={
              canUnlinkSelected
                ? 'Unlink selected clips'
                : 'Link selected video and audio clips'
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fb-muted hover:enabled:bg-white/[0.06] hover:enabled:text-fb-text disabled:cursor-not-allowed disabled:opacity-35"
          >
            {canUnlinkSelected ? (
              <Link2Off size={15} strokeWidth={1.75} />
            ) : (
              <Link2 size={15} strokeWidth={1.75} />
            )}
          </button>
          <span className="mx-1 h-4 w-px bg-fb-border" aria-hidden />
          <SaveFrameButton
            saving={savingFrame}
            onSave={() => void saveCurrentFrame()}
          />
          <span className="mx-1.5 h-4 w-px bg-fb-border" aria-hidden />
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
        ref={bodyScrollRef}
        className={`relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-none ${
          isHandDragging || isClipMoving ? 'cursor-grabbing' : 'cursor-default'
        }`}
        onClick={() => {
          if (timelineTool === 'cut') return
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          selectClip(null)
        }}
        onPointerMove={(event) => {
          if (isHandDragging || isClipMoving || clipDrag || isScrubbingRef.current) {
            setHoverFrameMs(null)
            return
          }
          let next = frameAtClientX(event.clientX)
          if (next != null && timelineTool === 'cut') {
            const playhead = snapToFrameMs(useEditorStore.getState().ui.playheadMs)
            const threshold = Math.max(1, pxToMs(12, pixelsPerSecond))
            if (Math.abs(next - playhead) <= threshold) next = playhead
          }
          setHoverFrameMs((current) => (current === next ? current : next))
        }}
        onPointerLeave={() => setHoverFrameMs(null)}
        onDragOver={onTimelineDragOver}
        onDrop={onTimelineDrop}
        onDragLeave={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) return
          setMediaDrop(null)
        }}
        onScroll={(event) => {
          setTimelineScrollLeft(event.currentTarget.scrollLeft)
        }}
      >
        <div
          className="relative bg-fb-surface"
          style={{
            display: 'grid',
            gridTemplateColumns: `${LABEL_WIDTH}px ${contentWidth}px`,
            gridTemplateRows: `${RULER_HEIGHT}px ${Math.max(displayTracks.length, 1) * TRACK_HEIGHT}px`,
            width: LABEL_WIDTH + contentWidth,
            height:
              RULER_HEIGHT + Math.max(displayTracks.length, 1) * TRACK_HEIGHT,
          }}
        >
          {/* Above the sticky ruler so horizontal scroll never paints ticks over titles */}
          <div className="sticky top-0 left-0 z-40 border-r border-b border-fb-border bg-fb-ruler" />

          <div
            className="sticky top-0 z-30 cursor-ew-resize border-b border-fb-border bg-fb-ruler"
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
                style={{
                  left: TIMELINE_X_INSET + msToPx(mark.ms, pixelsPerSecond),
                }}
              >
                <div
                  className={`w-px bg-fb-border-strong ${
                    mark.major ? 'h-full' : 'mt-3 h-[calc(100%-12px)]'
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

          <div className="sticky left-0 z-40 border-r border-fb-border bg-fb-panel">
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
            ref={tracksContentRef}
            className={`relative bg-fb-surface ${
              timelineTool === 'cut' ? 'cursor-crosshair' : ''
            }`}
          >
            {displayTracks.map((track) => (
              <div
                key={track.id}
                className={`relative border-b border-fb-border ${
                  mediaDrop?.trackId === track.id ||
                  (isClipMoving && dragPreferredTrackId === track.id)
                    ? 'bg-white/[0.045]'
                    : 'bg-fb-surface'
                }`}
                style={{ height: TRACK_HEIGHT }}
                onPointerDown={(event) => {
                  if (timelineTool === 'cut') return
                  if (event.target !== event.currentTarget) return
                  if (event.button !== 0) return
                  event.preventDefault()
                  const viewport = bodyScrollRef.current
                  if (!viewport) return
                  panRef.current = {
                    originClientX: event.clientX,
                    originClientY: event.clientY,
                    originScrollLeft: viewport.scrollLeft,
                    originScrollTop: viewport.scrollTop,
                    seekClientX: event.clientX,
                    moved: false,
                  }
                }}
              >
                {document.clips
                  .filter((clip) => {
                    const placement = placementByClipId?.get(clip.id)
                    if (!placement) return false
                    const moved =
                      placement.trackId !== clip.trackId ||
                      placement.timelineStartMs !== clip.timelineStartMs
                    return moved && clip.trackId === track.id
                  })
                  .map((clip) => {
                    const durationMs = clip.sourceOutMs - clip.sourceInMs
                    return (
                      <div
                        key={`${clip.id}-origin`}
                        className={`pointer-events-none absolute top-1.5 rounded-md border-2 border-dashed opacity-35 ${
                          track.kind === 'video'
                            ? 'border-fb-video-border bg-fb-video/40'
                            : 'border-fb-audio-border bg-fb-audio/40'
                        }`}
                        style={{
                          left:
                            TIMELINE_X_INSET +
                            msToPx(clip.timelineStartMs, pixelsPerSecond),
                          width: Math.max(8, msToPx(durationMs, pixelsPerSecond)),
                          height: 'calc(100% - 12px)',
                        }}
                      />
                    )
                  })}
                {document.clips
                  .filter((clip) => {
                    const placement = placementByClipId?.get(clip.id)
                    if (placement) return placement.trackId === track.id
                    return clip.trackId === track.id
                  })
                  .map((clip) => {
                    const placement = placementByClipId?.get(clip.id)
                    const isMoving = Boolean(
                      clipDrag &&
                        clipDrag.mode === 'move' &&
                        (clipDrag.clipId === clip.id ||
                          (Boolean(clipDrag.linkGroupId) &&
                            clip.linkGroupId === clipDrag.linkGroupId)),
                    )
                    return (
                      <TimelineClipBlock
                        key={clip.id}
                        clip={clip}
                        track={track}
                        pixelsPerSecond={pixelsPerSecond}
                        selected={selectedClipIds.includes(clip.id)}
                        linkedHighlight={
                          !selectedClipIds.includes(clip.id) &&
                          clip.linkGroupId != null &&
                          selectedLinkGroupIds.has(clip.linkGroupId)
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
                        isMoving={isMoving}
                        blade={timelineTool === 'cut'}
                        onSelect={(additive) =>
                          selectClip(clip.id, { additive })
                        }
                        onPointerDownMove={(clientX, clientY) => {
                          const underMs = frameAtClientX(clientX)
                          dragGrabOffsetMsRef.current =
                            (underMs ?? clip.timelineStartMs) - clip.timelineStartMs
                          clipDragPointerRef.current = { x: clientX, y: clientY }
                          dragDeltaMsRef.current = 0
                          dragPreferredTrackIdRef.current = track.id
                          setDragDeltaMs(0)
                          setDragPreferredTrackId(track.id)
                          setHoverFrameMs(null)
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
                          setHoverFrameMs(null)
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
                        onBlade={(clientX) => {
                          const cutMs = cutTimeAtClientX(clientX)
                          if (cutMs == null) return
                          splitClipsAt([clip.id], cutMs)
                        }}
                      />
                    )
                  })}
                {dropPlan?.placements
                  .filter((item) => item.trackId === track.id)
                  .map((item, index) => {
                    const grabbedCount = mediaDrop?.mediaSourceIds.length ?? 0
                    const lead = dropPlan.placements[0]
                    const showCount =
                      grabbedCount > 1 &&
                      index === 0 &&
                      lead != null &&
                      item.trackId === lead.trackId &&
                      item.timelineStartMs === lead.timelineStartMs
                    return (
                      <div
                        key={`${item.role}-${item.timelineStartMs}-${index}`}
                        className={`pointer-events-none absolute top-1.5 z-10 rounded-md border-2 border-dashed opacity-80 ${
                          item.role === 'video'
                            ? 'border-fb-video-border bg-fb-video/50'
                            : 'border-fb-audio-border bg-fb-audio/50'
                        }`}
                        style={{
                          left:
                            TIMELINE_X_INSET +
                            msToPx(item.timelineStartMs, pixelsPerSecond),
                          width: Math.max(
                            8,
                            msToPx(item.durationMs, pixelsPerSecond),
                          ),
                          height: 'calc(100% - 12px)',
                        }}
                      >
                        {showCount && (
                          <span className="absolute top-1 left-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fb-accent px-1 text-[11px] font-bold tracking-normal text-white">
                            {grabbedCount}
                          </span>
                        )}
                      </div>
                    )
                  })}
                {mediaDrop?.fileDrop && mediaDrop.trackId === track.id && (
                  <div
                    className="pointer-events-none absolute top-1.5 z-10 rounded-md border-2 border-dashed border-fb-border-strong bg-white/10"
                    style={{
                      left:
                        TIMELINE_X_INSET +
                        msToPx(mediaDrop.timelineStartMs, pixelsPerSecond),
                      width: 96,
                      height: 'calc(100% - 12px)',
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {hoverPlayheadLeft != null && (
            <div
              className={`pointer-events-none absolute top-0 bottom-0 z-30 w-px ${
                timelineTool === 'cut' ? 'bg-[#ff5c5c]' : 'bg-fb-playhead/35'
              }`}
              style={{ left: LABEL_WIDTH + hoverPlayheadLeft }}
              aria-hidden
            >
              <div
                className={`absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full ${
                  timelineTool === 'cut' ? 'bg-[#ff5c5c]' : 'bg-fb-playhead/35'
                }`}
              />
            </div>
          )}

          <TimelinePlayhead viewportRef={bodyScrollRef} />
        </div>
      </div>
    </section>
  )
}
