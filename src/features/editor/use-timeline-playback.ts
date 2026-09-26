import { useEffect, useRef, type RefObject } from 'react'
import {
  getPlaybackEndMs,
  nextPlayheadWhilePlaying,
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
  const pendingSeekSecRef = useRef<number | null>(null)
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

    const requestSeek = (mediaEl: HTMLMediaElement, targetSec: number) => {
      if (Math.abs(mediaEl.currentTime - targetSec) <= SEEK_EPSILON_SEC) {
        pendingSeekSecRef.current = null
        return false
      }
      pendingSeekSecRef.current = targetSec
      mediaEl.currentTime = targetSec
      return true
    }

    const mediaTimeIsReady = (mediaEl: HTMLMediaElement) => {
      const pending = pendingSeekSecRef.current
      if (pending == null) return mediaEl.readyState >= 1
      if (
        mediaEl.readyState >= 1 &&
        Math.abs(mediaEl.currentTime - pending) <= SEEK_EPSILON_SEC
      ) {
        pendingSeekSecRef.current = null
        return true
      }
      return false
    }

    const ensureClipMedia = (
      clipId: string,
      mediaSourceId: string,
      sourceTimeMs: number,
    ): { element: HTMLMediaElement; holdClock: boolean } | null => {
      const mediaEl = mediaRef.current
      if (!mediaEl) return null

      const objectUrl = getObjectUrl(mediaSourceId)
      if (!objectUrl) return null

      const sameSource = attachedMediaIdRef.current === mediaSourceId
      const sameClip = attachedClipIdRef.current === clipId

      if (!sameSource) {
        attachedMediaIdRef.current = mediaSourceId
        attachedClipIdRef.current = clipId
        pendingSeekSecRef.current = msToSeconds(sourceTimeMs)
        mediaEl.src = objectUrl
        mediaEl.load()
        const onReady = () => {
          const live = resolvePlaybackAt(
            documentRef.current,
            playheadRef.current,
          )
          const targetSec =
            live.status === 'clip'
              ? msToSeconds(live.sourceTimeMs)
              : msToSeconds(sourceTimeMs)
          requestSeek(mediaEl, targetSec)
          if (isPlayingRef.current) {
            void mediaEl.play().catch(() => {
              setPlaybackError('Browser blocked or failed media playback.')
            })
          }
        }
        mediaEl.addEventListener('loadedmetadata', onReady, { once: true })
        return { element: mediaEl, holdClock: true }
      }

      if (!sameClip) {
        attachedClipIdRef.current = clipId
        if (mediaEl.readyState < 1) {
          return { element: mediaEl, holdClock: true }
        }
        const targetSec = msToSeconds(sourceTimeMs)
        // The media clock often lands slightly past a cut in the same file.
        // Seeking back to the boundary is what makes the picture and playhead jump.
        const aheadSec = mediaEl.currentTime - targetSec
        if (aheadSec >= 0 && aheadSec <= SEEK_EPSILON_SEC * 2) {
          pendingSeekSecRef.current = null
          return { element: mediaEl, holdClock: false }
        }
        return {
          element: mediaEl,
          holdClock: requestSeek(mediaEl, targetSec),
        }
      }

      return { element: mediaEl, holdClock: !mediaTimeIsReady(mediaEl) }
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
        pendingSeekSecRef.current = null
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
        pendingSeekSecRef.current = null
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
      const clockHeld = bound.holdClock || !mediaTimeIsReady(mediaEl)

      if (!clockHeld && mediaEl.readyState >= 1) {
        const expectedSource = timelineToSourceTimeMs(resolution.clip, timeMs)
        const driftSec = mediaEl.currentTime - msToSeconds(expectedSource)
        // Media ahead of the playhead is followed. Seeking it backward
        // rewinds the picture to the cut.
        if (driftSec < -(SEEK_EPSILON_SEC * 2)) {
          requestSeek(mediaEl, msToSeconds(resolution.sourceTimeMs))
        }
      }

      if (mediaEl.paused && mediaEl.readyState >= 2 && pendingSeekSecRef.current == null) {
        void mediaEl.play().catch(() => {
          setPlaybackError('Browser blocked or failed media playback.')
        })
      }

      const mediaTimelineMs =
        !clockHeld &&
        pendingSeekSecRef.current == null &&
        !mediaEl.paused &&
        Number.isFinite(mediaEl.currentTime)
          ? sourceToTimelineTimeMs(
              resolution.clip,
              secondsToMs(mediaEl.currentTime),
            )
          : null

      timeMs = nextPlayheadWhilePlaying({
        playheadMs: timeMs,
        deltaMs,
        mediaTimelineMs,
        playbackEndMs: endMs,
      })

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
