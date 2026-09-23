import { Pause, Play, SkipBack } from 'lucide-react'
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
  const restartPlayback = useEditorStore((state) => state.restartPlayback)

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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-fb-app">
      <div className="flex h-9 items-center justify-between gap-2 border-b border-fb-border bg-fb-panel px-3">
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

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="relative flex max-h-full w-full max-w-3xl items-center justify-center">
          <div className="relative aspect-video w-full max-h-[min(420px,100%)] overflow-hidden bg-black shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <video
              ref={mediaRef}
              className={`h-full w-full object-contain ${showMedia ? 'opacity-100' : 'opacity-0'}`}
              playsInline
              preload="auto"
              aria-label="Timeline preview"
            />

            {isGap && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black">
                <span className="text-[12px] text-zinc-500">
                  {timelineDurationMs <= 0
                    ? 'Add clips to the active video track'
                    : resolution.status === 'ended'
                      ? 'End of timeline'
                      : 'Gap'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex h-11 items-center gap-2 border-t border-fb-border bg-fb-surface px-3">
        <button
          type="button"
          onClick={() => restartPlayback()}
          disabled={timelineDurationMs <= 0}
          aria-label="Restart from beginning"
          title="Restart"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-fb-border bg-white text-fb-text disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-fb-app"
        >
          <SkipBack size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => togglePlayback()}
          disabled={timelineDurationMs <= 0 && !isPlaying}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause' : 'Play'}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-fb-border bg-white text-fb-text disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-fb-app"
        >
          {isPlaying ? (
            <Pause size={14} strokeWidth={1.75} />
          ) : (
            <Play size={14} strokeWidth={1.75} className="translate-x-px" />
          )}
        </button>
        <div className="font-mono text-[12px] tabular-nums text-fb-text">
          {formatTimecode(playheadMs)}
          <span className="text-fb-subtle"> / </span>
          {formatTimecode(timelineDurationMs)}
        </div>
        <p
          className={`ml-auto truncate text-[11px] ${
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
