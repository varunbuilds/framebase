import { Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getMediaSourceById } from '@/features/editor/project'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'
import { formatTimecode, msToSeconds, secondsToMs } from '@/utils/time'

export function PreviewPanel() {
  const document = useEditorStore((state) => state.document)
  const selectedClipId = useEditorStore((state) => state.ui.selectedClipId)
  const isPlaying = useEditorStore((state) => state.ui.isPlaying)
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying)
  const setPlayheadMs = useEditorStore((state) => state.setPlayheadMs)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [previewTimeMs, setPreviewTimeMs] = useState(0)

  const selectedClip = useMemo(
    () => document.clips.find((clip) => clip.id === selectedClipId) ?? null,
    [document.clips, selectedClipId],
  )

  const mediaSource = selectedClip
    ? getMediaSourceById(document, selectedClip.mediaSourceId)
    : null

  const objectUrl = mediaSource ? getObjectUrl(mediaSource.id) : undefined
  const clipDurationMs = selectedClip
    ? selectedClip.sourceOutMs - selectedClip.sourceInMs
    : 0

  useEffect(() => {
    const media =
      mediaSource?.kind === 'audio' ? audioRef.current : videoRef.current
    if (!media || !selectedClip || !objectUrl) return

    const onTimeUpdate = () => {
      const sourceTimeMs = secondsToMs(media.currentTime)
      const relativeMs = Math.max(0, sourceTimeMs - selectedClip.sourceInMs)
      setPreviewTimeMs(relativeMs)
      setPlayheadMs(selectedClip.timelineStartMs + relativeMs)

      if (sourceTimeMs >= selectedClip.sourceOutMs - 30) {
        media.pause()
        setIsPlaying(false)
        media.currentTime = msToSeconds(selectedClip.sourceInMs)
        setPreviewTimeMs(0)
      }
    }

    const onEnded = () => setIsPlaying(false)

    media.addEventListener('timeupdate', onTimeUpdate)
    media.addEventListener('ended', onEnded)
    return () => {
      media.removeEventListener('timeupdate', onTimeUpdate)
      media.removeEventListener('ended', onEnded)
    }
  }, [mediaSource?.kind, objectUrl, selectedClip, setIsPlaying, setPlayheadMs])

  useEffect(() => {
    const media =
      mediaSource?.kind === 'audio' ? audioRef.current : videoRef.current
    if (!media || !selectedClip) return

    media.currentTime = msToSeconds(selectedClip.sourceInMs)
    setPreviewTimeMs(0)
    setIsPlaying(false)
  }, [selectedClip?.id, mediaSource?.kind, selectedClip, setIsPlaying])

  useEffect(() => {
    const media =
      mediaSource?.kind === 'audio' ? audioRef.current : videoRef.current
    if (!media) return

    if (isPlaying) {
      void media.play().catch(() => setIsPlaying(false))
    } else {
      media.pause()
    }
  }, [isPlaying, mediaSource?.kind, setIsPlaying])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-fb-app">
      <div className="flex h-9 items-center border-b border-fb-border bg-fb-panel px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Preview
        </h2>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {!selectedClip || !mediaSource || !objectUrl ? (
          <div className="flex max-w-sm flex-col items-center gap-2 text-center">
            <div className="flex h-28 w-48 items-center justify-center rounded border border-dashed border-fb-border-strong bg-fb-panel">
              <span className="text-[12px] text-fb-subtle">No clip selected</span>
            </div>
            <p className="text-[12px] text-fb-muted">
              Select a clip on the timeline or add media to preview playback.
            </p>
          </div>
        ) : mediaSource.kind === 'video' ? (
          <div className="flex max-h-full max-w-full flex-col items-center gap-3">
            <video
              ref={videoRef}
              key={objectUrl}
              src={objectUrl}
              className="max-h-[min(420px,100%)] max-w-full bg-black object-contain shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              playsInline
              preload="metadata"
              aria-label={`Preview ${mediaSource.name}`}
            />
          </div>
        ) : (
          <div className="flex w-full max-w-md flex-col items-center gap-4 rounded border border-fb-border bg-fb-panel px-6 py-8">
            <p className="text-[13px] font-medium text-fb-text">{mediaSource.name}</p>
            <p className="text-[11px] text-fb-muted">Audio clip</p>
            <audio
              ref={audioRef}
              key={objectUrl}
              src={objectUrl}
              preload="metadata"
              className="w-full"
              aria-label={`Preview ${mediaSource.name}`}
            />
          </div>
        )}
      </div>

      <div className="flex h-11 items-center gap-3 border-t border-fb-border bg-fb-surface px-3">
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          disabled={!selectedClip || !objectUrl}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-fb-border bg-white text-fb-text disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-fb-app"
        >
          {isPlaying ? (
            <Pause size={14} strokeWidth={1.75} />
          ) : (
            <Play size={14} strokeWidth={1.75} className="translate-x-px" />
          )}
        </button>
        <div className="font-mono text-[12px] tabular-nums text-fb-text">
          {formatTimecode(previewTimeMs)}
          <span className="text-fb-subtle"> / </span>
          {formatTimecode(clipDurationMs)}
        </div>
        {selectedClip && mediaSource && (
          <p className="ml-auto truncate text-[11px] text-fb-muted">
            {mediaSource.name}
          </p>
        )}
      </div>
    </section>
  )
}
