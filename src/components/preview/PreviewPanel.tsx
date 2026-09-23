import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useMemo, useRef } from 'react'
import {
  getPlaybackEndMs,
  resolvePlaybackAt,
  resolvePlaybackTrack,
} from '@/features/editor/playback'
import { useTimelinePlayback } from '@/features/editor/use-timeline-playback'
import { getMediaSourceById } from '@/features/editor/project'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'
import { formatTimecode } from '@/utils/time'

export function PreviewPanel() {
  const document = useEditorStore((state) => state.document)
  const playheadMs = useEditorStore((state) => state.ui.playheadMs)
  const isPlaying = useEditorStore((state) => state.ui.isPlaying)
  const playbackError = useEditorStore((state) => state.ui.playbackError)
  const togglePlayback = useEditorStore((state) => state.togglePlayback)
  const seekTo = useEditorStore((state) => state.seekTo)

  const mediaRef = useRef<HTMLVideoElement>(null)
  useTimelinePlayback(mediaRef)

  const playbackTrack = useMemo(
    () => resolvePlaybackTrack(document),
    [document],
  )
  const timelineDurationMs = getPlaybackEndMs(document)
  const resolution = resolvePlaybackAt(document, playheadMs)

  const activeMedia =
    resolution.status === 'clip'
      ? getMediaSourceById(document, resolution.mediaSourceId)
      : null
  const objectUrl =
    resolution.status === 'clip'
      ? getObjectUrl(resolution.mediaSourceId)
      : undefined

  const showMedia =
    resolution.status === 'clip' && Boolean(objectUrl) && Boolean(activeMedia)
  const isGap =
    resolution.status === 'gap' ||
    resolution.status === 'ended' ||
    resolution.status === 'empty' ||
    (resolution.status === 'clip' && !objectUrl)

  const statusLabel = (() => {
    if (playbackError) return playbackError
    if (!playbackTrack) return 'No playback track'
    if (timelineDurationMs <= 0) return 'Timeline is empty'
    if (resolution.status === 'gap') return 'Gap'
    if (resolution.status === 'ended') return 'End of timeline'
    if (resolution.status === 'clip' && activeMedia) return activeMedia.name
    if (resolution.status === 'clip' && !objectUrl) return 'Media unavailable'
    return playbackTrack.name
  })()

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-fb-panel">
      <div className="flex h-11 items-center justify-between gap-2 px-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Preview
        </h2>
        {playbackTrack && (
          <p className="truncate text-[10px] text-fb-subtle">
            Playing track: {playbackTrack.name}
            <span className="text-fb-subtle"> · single-track</span>
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-7">
        <div className="relative flex max-h-full w-full max-w-[760px] items-center justify-center">
          <div className="relative aspect-video w-full max-h-[min(460px,100%)] overflow-hidden rounded-lg border border-fb-border-strong bg-[#181e22] shadow-[0_18px_70px_rgba(0,0,0,0.32)]">
            <video
              ref={mediaRef}
              className={`h-full w-full object-contain ${showMedia ? 'opacity-100' : 'opacity-0'}`}
              playsInline
              preload="auto"
              aria-label="Timeline preview"
            />

            {isGap && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#181e22]">
                <div className="flex flex-col items-center gap-4 text-center">
                  <span className="grid h-14 w-20 place-items-center before:absolute before:h-4 before:w-4 before:border-t before:border-l before:border-white/35 after:absolute after:h-4 after:w-4 after:border-r after:border-b after:border-white/35">
                    <span className="text-xl font-light text-white/60">+</span>
                  </span>
                  <span className="text-[13px] text-white/45">
                  {timelineDurationMs <= 0
                    ? 'Add clips to the active video track'
                    : resolution.status === 'ended'
                      ? 'End of timeline'
                      : 'Gap'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex h-12 items-center justify-center border-t border-fb-border bg-fb-surface px-4">
        <div className="absolute left-4 font-mono text-[12px] tabular-nums text-fb-text">
          {formatTimecode(playheadMs)}
          <span className="text-fb-subtle"> / </span>
          {formatTimecode(timelineDurationMs)}
        </div>
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => seekTo(Math.max(0, playheadMs - 5000))}
            disabled={timelineDurationMs <= 0}
            aria-label="Previous"
            title="Previous"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/65 disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-white/[0.08]"
          >
            <SkipBack size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => togglePlayback()}
            disabled={timelineDurationMs <= 0 && !isPlaying}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-black disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-white/85"
          >
            {isPlaying ? (
              <Pause size={14} strokeWidth={1.75} />
            ) : (
              <Play size={14} strokeWidth={1.75} className="translate-x-px" />
            )}
          </button>
          <button
            type="button"
            onClick={() => seekTo(Math.min(timelineDurationMs, playheadMs + 5000))}
            disabled={timelineDurationMs <= 0}
            aria-label="Next"
            title="Next"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/65 disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-white/[0.08]"
          >
            <SkipForward size={15} strokeWidth={1.75} />
          </button>
        </div>
        <p
          className={`absolute right-4 max-w-[30%] truncate text-[11px] ${
            playbackError ? 'text-fb-danger' : 'text-fb-muted'
          }`}
          role={playbackError ? 'alert' : undefined}
        >
          {statusLabel}
        </p>
      </div>
    </section>
  )
}
