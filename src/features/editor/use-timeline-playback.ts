import { useEffect, useRef, type RefObject } from 'react'
import {
  getPlaybackEndMs,
  resolvePlaybackAt,
  sourceToTimelineTimeMs,
  timelineToSourceTimeMs,
} from '@/features/editor/playback'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'
import type { ProjectDocument } from '@/types/timeline'
import { msToSeconds, secondsToMs } from '@/utils/time'

const SEEK_EPSILON_SEC = 0.05

/**
 * Drives timeline playhead + a single HTMLMediaElement from store UI state.
 * Playback ticks update transient UI only (never document / undo history).
 */
export function useTimelinePlayback(
  mediaRef: RefObject<HTMLMediaElement | null>,
) {
  const document = useEditorStore((state) => state.document)
  const isPlaying = useEditorStore((state) => state.ui.isPlaying)
  const setPlayheadMs = useEditorStore((state) => state.setPlayheadMs)
  const pause = useEditorStore((state) => state.pause)
  const setPlaybackError = useEditorStore((state) => state.setPlaybackError)

  const attachedMediaIdRef = useRef<string | null>(null)
  const attachedClipIdRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameTsRef = useRef<number | null>(null)
  const playheadRef = useRef(useEditorStore.getState().ui.playheadMs)
  const isPlayingRef = useRef(isPlaying)
  const documentRef = useRef<ProjectDocument>(document)
  const appliedSeekVersionRef = useRef(
    useEditorStore.getState().ui.seekVersion,
  )

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    documentRef.current = document
  }, [document])

  // Paused seeks update the element through a store subscription so the
  // playback clock does not rerender this hook's parent every frame.
  // While playing, the rAF loop owns media seeking.
  useEffect(() => {
    let detachLoaded: (() => void) | undefined

    const syncPaused = () => {
      const { document: doc, ui } = useEditorStore.getState()
      playheadRef.current = ui.playheadMs
      if (ui.isPlaying) return

      const media = mediaRef.current
      const resolution = resolvePlaybackAt(doc, ui.playheadMs)

      if (resolution.status !== 'clip') {
        if (media && !media.paused) media.pause()
        return
      }

      if (!media) return

      const objectUrl = getObjectUrl(resolution.mediaSourceId)
      if (!objectUrl) {
        setPlaybackError('Media file is unavailable for the active clip.')
        return
      }

      const applyCurrentTime = () => {
        media.currentTime = msToSeconds(resolution.sourceTimeMs)
      }

      if (attachedMediaIdRef.current !== resolution.mediaSourceId) {
        detachLoaded?.()
        attachedMediaIdRef.current = resolution.mediaSourceId
        attachedClipIdRef.current = resolution.clip.id
        media.src = objectUrl
        const onLoaded = () => {
          applyCurrentTime()
        }
        media.addEventListener('loadedmetadata', onLoaded, { once: true })
        detachLoaded = () => {
          media.removeEventListener('loadedmetadata', onLoaded)
        }
        media.load()
        return
      }

      if (media.readyState >= 1) {
        const targetSec = msToSeconds(resolution.sourceTimeMs)
        if (Math.abs(media.currentTime - targetSec) > SEEK_EPSILON_SEC) {
          applyCurrentTime()
        }
      }
    }

    syncPaused()
    const unsubscribe = useEditorStore.subscribe(syncPaused)
    return () => {
      unsubscribe()
      detachLoaded?.()
    }
  }, [mediaRef, setPlaybackError])

  // Single playback loop — one rAF chain while playing.
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastFrameTsRef.current = null
      const media = mediaRef.current
      if (media && !media.paused) media.pause()
      return
    }

    let cancelled = false

    const onMediaError = () => {
      setPlaybackError('Playback failed while reading the media file.')
    }

    const media = mediaRef.current
    media?.addEventListener('error', onMediaError)

    const ensureClipMedia = (
      clipId: string,
      mediaSourceId: string,
      sourceTimeMs: number,
    ): { element: HTMLMediaElement; rebound: boolean } | null => {
      const mediaEl = mediaRef.current
      if (!mediaEl) return null

      const objectUrl = getObjectUrl(mediaSourceId)
      if (!objectUrl) return null

      const sameSource = attachedMediaIdRef.current === mediaSourceId
      const sameClip = attachedClipIdRef.current === clipId

      if (!sameSource) {
        attachedMediaIdRef.current = mediaSourceId
        attachedClipIdRef.current = clipId
        mediaEl.src = objectUrl
        mediaEl.load()
        const onReady = () => {
          mediaEl.currentTime = msToSeconds(sourceTimeMs)
          if (isPlayingRef.current) {
            void mediaEl.play().catch(() => {
              setPlaybackError('Browser blocked or failed media playback.')
            })
          }
        }
        mediaEl.addEventListener('loadedmetadata', onReady, { once: true })
        return { element: mediaEl, rebound: true }
      }

      if (!sameClip) {
        attachedClipIdRef.current = clipId
        if (mediaEl.readyState >= 1) {
          mediaEl.currentTime = msToSeconds(sourceTimeMs)
        }
        return { element: mediaEl, rebound: true }
      }

      return { element: mediaEl, rebound: false }
    }

    const tick = (timestamp: number) => {
      if (cancelled || !isPlayingRef.current) return

      const doc = documentRef.current
      const endMs = getPlaybackEndMs(doc)
      if (endMs <= 0) {
        pause()
        return
      }

      const previousTs = lastFrameTsRef.current
      lastFrameTsRef.current = timestamp
      const deltaMs =
        previousTs == null
          ? 0
          : Math.min(100, Math.max(0, timestamp - previousTs))

      let timeMs = playheadRef.current
      const seekVersion = useEditorStore.getState().ui.seekVersion
      if (seekVersion !== appliedSeekVersionRef.current) {
        appliedSeekVersionRef.current = seekVersion
        timeMs = useEditorStore.getState().ui.playheadMs
        playheadRef.current = timeMs
        // Force media re-sync on the newly adopted playhead.
        attachedMediaIdRef.current = null
      }
      const resolution = resolvePlaybackAt(doc, timeMs)

      if (resolution.status === 'ended' || timeMs >= endMs) {
        setPlayheadMs(endMs)
        pause()
        return
      }

      if (resolution.status === 'empty') {
        pause()
        return
      }

      if (resolution.status === 'gap') {
        const mediaEl = mediaRef.current
        if (mediaEl && !mediaEl.paused) mediaEl.pause()

        timeMs = Math.min(endMs, timeMs + deltaMs)
        playheadRef.current = timeMs
        setPlayheadMs(timeMs)

        if (timeMs >= endMs) {
          pause()
          return
        }

        rafRef.current = requestAnimationFrame(tick)
        return
      }

      // status === 'clip'
      const bound = ensureClipMedia(
        resolution.clip.id,
        resolution.mediaSourceId,
        resolution.sourceTimeMs,
      )

      if (!bound || !getObjectUrl(resolution.mediaSourceId)) {
        timeMs = Math.min(endMs, timeMs + deltaMs)
        playheadRef.current = timeMs
        setPlayheadMs(timeMs)
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const mediaEl = bound.element

      if (!bound.rebound && mediaEl.readyState >= 1) {
        const expectedSource = timelineToSourceTimeMs(resolution.clip, timeMs)
        const drift = Math.abs(mediaEl.currentTime - msToSeconds(expectedSource))
        if (drift > SEEK_EPSILON_SEC * 2) {
          mediaEl.currentTime = msToSeconds(resolution.sourceTimeMs)
        }
      }

      if (mediaEl.paused && mediaEl.readyState >= 2) {
        void mediaEl.play().catch(() => {
          setPlaybackError('Browser blocked or failed media playback.')
        })
      }

      if (
        !bound.rebound &&
        !mediaEl.paused &&
        Number.isFinite(mediaEl.currentTime)
      ) {
        timeMs = Math.min(
          endMs,
          sourceToTimelineTimeMs(resolution.clip, secondsToMs(mediaEl.currentTime)),
        )
      } else if (deltaMs > 0) {
        timeMs = Math.min(endMs, timeMs + deltaMs)
      }

      const clipEnd =
        resolution.clip.timelineStartMs +
        (resolution.clip.sourceOutMs - resolution.clip.sourceInMs)

      if (timeMs >= clipEnd) {
        // Land exactly on the boundary so the next tick resolves the following clip or gap.
        timeMs = clipEnd
        if (!mediaEl.paused) mediaEl.pause()
      }

      playheadRef.current = timeMs
      setPlayheadMs(timeMs)

      if (timeMs >= endMs) {
        pause()
        return
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      media?.removeEventListener('error', onMediaError)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastFrameTsRef.current = null
    }
  }, [isPlaying, mediaRef, pause, setPlayheadMs, setPlaybackError])
}
