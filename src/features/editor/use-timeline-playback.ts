import { useEffect, useRef, type RefObject } from 'react'
import {
  audioClipsToPrepare,
  audioPlayheadSeekSec,
  getPlaybackEndMs,
  nextPlayheadWhilePlaying,
  resolveActiveVideoClip,
  resolvePlaybackAt,
  sourceToTimelineTimeMs,
  stepPlayheadMs,
  timelineToSourceTimeMs,
  videoSourceUsesEmbeddedAudio,
} from '@/features/editor/playback'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'
import type { ProjectDocument } from '@/types/timeline'
import type { EditorUiState } from '@/types/editor'
import { msToSeconds, secondsToMs } from '@/utils/time'

const SEEK_EPSILON_SEC = 0.05
const AUDIO_DRIFT_SEC = 0.1

type AudioSlot = {
  clipId: string
  url: string
  element: HTMLAudioElement
  /** Latest in-point or playhead the element should hold before it is playing. */
  parkSec: number
  /** Play after the in-flight seek only if the clip is still active. */
  wantPlay: boolean
}

type PlaybackAudio = {
  volume: number
  muted: boolean
}

function releaseAudioSlot(slot: AudioSlot) {
  slot.wantPlay = false
  slot.element.pause()
  slot.element.removeAttribute('src')
  slot.element.load()
}

function playheadSound(args: {
  media: HTMLMediaElement | null
  pool: Map<string, AudioSlot>
  document: ProjectDocument
  playheadMs: number
  playing: boolean
  volume: number
  muted: boolean
}) {
  applyVideoSound(args)
  syncTimelineAudio(args)
}

function applyVideoSound(args: {
  media: HTMLMediaElement | null
  document: ProjectDocument
  playheadMs: number
  volume: number
  muted: boolean
}) {
  if (!args.media) return
  const video = resolveActiveVideoClip(args.document, args.playheadMs)
  const carry =
    video != null &&
    videoSourceUsesEmbeddedAudio(args.document, video.clip.mediaSourceId)
  args.media.volume = args.volume
  args.media.muted = args.muted || !carry
}

function syncTimelineAudio(args: {
  pool: Map<string, AudioSlot>
  document: ProjectDocument
  playheadMs: number
  playing: boolean
  volume: number
  muted: boolean
}) {
  const cues = audioClipsToPrepare(args.document, args.playheadMs)
  const keep = new Set<string>()

  for (const cue of cues) {
    const objectUrl = getObjectUrl(cue.mediaSourceId)
    if (!objectUrl) {
      const stale = args.pool.get(cue.clipId)
      if (stale) {
        releaseAudioSlot(stale)
        args.pool.delete(cue.clipId)
      }
      continue
    }
    keep.add(cue.clipId)

    let slot = args.pool.get(cue.clipId)
    if (!slot || slot.url !== objectUrl) {
      if (slot) releaseAudioSlot(slot)
      const element = document.createElement('audio')
      element.preload = 'auto'
      const created: AudioSlot = {
        clipId: cue.clipId,
        url: objectUrl,
        element,
        parkSec: cue.parkSourceMs / 1000,
        wantPlay: false,
      }
      element.src = objectUrl
      element.addEventListener(
        'loadedmetadata',
        () => {
          element.currentTime = created.parkSec
        },
        { once: true },
      )
      element.load()
      slot = created
      args.pool.set(cue.clipId, slot)
    }

    slot.parkSec = cue.parkSourceMs / 1000
    slot.wantPlay = args.playing && cue.active
    const element = slot.element
    element.volume = args.volume
    element.muted = args.muted
    if (element.readyState < 1) continue

    const targetSec = slot.parkSec
    const sourceInSec = cue.sourceInMs / 1000
    if (slot.wantPlay) {
      if (element.paused) {
        if (element.seeking) continue
        const seekSec = audioPlayheadSeekSec({
          currentSec: element.currentTime,
          sourceInSec,
          targetSec,
        })
        if (seekSec != null) {
          element.currentTime = seekSec
          element.addEventListener(
            'seeked',
            () => {
              if (slot.wantPlay) void element.play().catch(() => undefined)
            },
            { once: true },
          )
        } else if (element.readyState >= 2) {
          void element.play().catch(() => undefined)
        }
      } else if (element.currentTime - targetSec < -AUDIO_DRIFT_SEC) {
        element.currentTime = targetSec
      }
      continue
    }

    if (!element.paused) element.pause()
    if (Math.abs(element.currentTime - targetSec) > SEEK_EPSILON_SEC) {
      element.currentTime = targetSec
    }
  }

  for (const [clipId, slot] of args.pool) {
    if (keep.has(clipId)) continue
    releaseAudioSlot(slot)
    args.pool.delete(clipId)
  }
}

type PausedSyncSnapshot = {
  document: ProjectDocument
  playheadMs: EditorUiState['playheadMs']
  isPlaying: boolean
  seekVersion: number
}

/**
 * Recording a playback error must not run paused sync again.
 * Sync follows the document, playhead, and play/pause only.
 */
export function pausedPlaybackFollowsChange(
  previous: PausedSyncSnapshot,
  next: PausedSyncSnapshot,
): boolean {
  return (
    previous.document !== next.document ||
    previous.playheadMs !== next.playheadMs ||
    previous.isPlaying !== next.isPlaying ||
    previous.seekVersion !== next.seekVersion
  )
}

/**
 * A clip without bytes is still loading. That is not a playback failure,
 * and it must not call setPlaybackError from inside paused sync.
 */
export function pausedPreviewStep(args: {
  status: 'clip' | 'gap' | 'ended' | 'empty'
  hasMediaElement: boolean
  hasObjectUrl: boolean
}): 'idle' | 'not-ready' | 'attach' {
  if (args.status !== 'clip') return 'idle'
  if (!args.hasMediaElement || !args.hasObjectUrl) return 'not-ready'
  return 'attach'
}

/**
 * Drives timeline playhead + a single HTMLMediaElement from store UI state.
 * Playback ticks update transient UI only (never document / undo history).
 */
export function useTimelinePlayback(
  mediaRef: RefObject<HTMLMediaElement | null>,
  audio: PlaybackAudio = { volume: 1, muted: false },
) {
  const document = useEditorStore((state) => state.document)
  const isPlaying = useEditorStore((state) => state.ui.isPlaying)
  const setPlayheadMs = useEditorStore((state) => state.setPlayheadMs)
  const pause = useEditorStore((state) => state.pause)
  const setPlaybackError = useEditorStore((state) => state.setPlaybackError)

  const attachedMediaIdRef = useRef<string | null>(null)
  const attachedUrlRef = useRef<string | null>(null)
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
  const audioPoolRef = useRef(new Map<string, AudioSlot>())
  const volumeRef = useRef(audio.volume)
  const userMutedRef = useRef(audio.muted)

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    documentRef.current = document
  }, [document])

  useEffect(() => {
    volumeRef.current = audio.volume
    userMutedRef.current = audio.muted
    playheadSound({
      media: mediaRef.current,
      pool: audioPoolRef.current,
      document: documentRef.current,
      playheadMs: playheadRef.current,
      playing: isPlayingRef.current,
      volume: audio.volume,
      muted: audio.muted,
    })
  }, [audio.muted, audio.volume, mediaRef])

  useEffect(() => {
    const pool = audioPoolRef.current
    return () => {
      for (const slot of pool.values()) {
        slot.element.pause()
        slot.element.removeAttribute('src')
        slot.element.load()
      }
      pool.clear()
    }
  }, [])

  // Paused seeks update the element through a store subscription so the
  // playback clock does not rerender this hook's parent every frame.
  // While playing, the rAF loop owns media seeking.
  useEffect(() => {
    let detachLoaded: (() => void) | undefined

    const syncPaused = () => {
      const { document: doc, ui } = useEditorStore.getState()
      playheadRef.current = ui.playheadMs
      documentRef.current = doc
      const media = mediaRef.current
      if (ui.isPlaying) return
      playheadSound({
        media,
        pool: audioPoolRef.current,
        document: doc,
        playheadMs: ui.playheadMs,
        playing: false,
        volume: volumeRef.current,
        muted: userMutedRef.current,
      })

      const resolution = resolvePlaybackAt(doc, ui.playheadMs)
      const objectUrl =
        resolution.status === 'clip' ? getObjectUrl(resolution.mediaSourceId) : undefined
      const step = pausedPreviewStep({
        status: resolution.status,
        hasMediaElement: Boolean(media),
        hasObjectUrl: Boolean(objectUrl),
      })

      if (step === 'idle') {
        if (media && !media.paused) media.pause()
        return
      }
      if (step === 'not-ready' || !media || resolution.status !== 'clip' || !objectUrl) {
        return
      }

      const targetSec = msToSeconds(resolution.sourceTimeMs)
      const applyCurrentTime = () => {
        if (Math.abs(media.currentTime - targetSec) > SEEK_EPSILON_SEC) {
          media.currentTime = targetSec
        }
      }
      const sourceIsCurrent =
        attachedMediaIdRef.current === resolution.mediaSourceId &&
        attachedUrlRef.current === objectUrl &&
        media.error == null &&
        media.src.length > 0

      if (!sourceIsCurrent) {
        detachLoaded?.()
        attachedMediaIdRef.current = resolution.mediaSourceId
        attachedUrlRef.current = objectUrl
        attachedClipIdRef.current = resolution.clip.id
        pendingSeekSecRef.current = targetSec
        media.src = objectUrl
        const onLoaded = () => {
          pendingSeekSecRef.current = null
          const live = resolvePlaybackAt(
            useEditorStore.getState().document,
            playheadRef.current,
          )
          const seekSec =
            live.status === 'clip' && live.clip.id === resolution.clip.id
              ? msToSeconds(live.sourceTimeMs)
              : targetSec
          if (Math.abs(media.currentTime - seekSec) > SEEK_EPSILON_SEC) {
            media.currentTime = seekSec
          }
        }
        media.addEventListener('loadedmetadata', onLoaded, { once: true })
        detachLoaded = () => {
          media.removeEventListener('loadedmetadata', onLoaded)
        }
        media.load()
        return
      }

      attachedClipIdRef.current = resolution.clip.id
      pendingSeekSecRef.current = null
      if (media.readyState >= 1) {
        applyCurrentTime()
      }
    }

    syncPaused()
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (
        !pausedPlaybackFollowsChange(
          {
            document: previous.document,
            playheadMs: previous.ui.playheadMs,
            isPlaying: previous.ui.isPlaying,
            seekVersion: previous.ui.seekVersion,
          },
          {
            document: state.document,
            playheadMs: state.ui.playheadMs,
            isPlaying: state.ui.isPlaying,
            seekVersion: state.ui.seekVersion,
          },
        )
      ) {
        return
      }
      syncPaused()
    })
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
      for (const slot of audioPoolRef.current.values()) {
        if (!slot.element.paused) slot.element.pause()
      }
      return
    }

    let cancelled = false
    let playbackStartFailed = false

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

      const sameSource =
        attachedMediaIdRef.current === mediaSourceId &&
        attachedUrlRef.current === objectUrl &&
        mediaEl.error == null &&
        mediaEl.src.length > 0
      const sameClip = attachedClipIdRef.current === clipId

      if (!sameSource) {
        playbackStartFailed = false
        attachedMediaIdRef.current = mediaSourceId
        attachedUrlRef.current = objectUrl
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
          if (isPlayingRef.current && mediaEl.paused) {
            void mediaEl.play().catch(() => {
              playbackStartFailed = true
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
      playheadSound({
        media: mediaRef.current,
        pool: audioPoolRef.current,
        document: doc,
        playheadMs: timeMs,
        playing: true,
        volume: volumeRef.current,
        muted: userMutedRef.current,
      })
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

        timeMs = stepPlayheadMs(timeMs, deltaMs, endMs)
        playheadRef.current = timeMs
        setPlayheadMs(timeMs)
        playheadSound({
        media: mediaRef.current,
        pool: audioPoolRef.current,
        document: doc,
        playheadMs: timeMs,
        playing: true,
        volume: volumeRef.current,
        muted: userMutedRef.current,
      })

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
        timeMs = stepPlayheadMs(timeMs, deltaMs, endMs)
        playheadRef.current = timeMs
        setPlayheadMs(timeMs)
        playheadSound({
        media: mediaRef.current,
        pool: audioPoolRef.current,
        document: doc,
        playheadMs: timeMs,
        playing: true,
        volume: volumeRef.current,
        muted: userMutedRef.current,
      })
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

      if (
        !playbackStartFailed &&
        mediaEl.paused &&
        mediaEl.readyState >= 2 &&
        pendingSeekSecRef.current == null &&
        mediaTimeIsReady(mediaEl)
      ) {
        void mediaEl.play().catch(() => {
          playbackStartFailed = true
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
      playheadSound({
        media: mediaRef.current,
        pool: audioPoolRef.current,
        document: doc,
        playheadMs: timeMs,
        playing: true,
        volume: volumeRef.current,
        muted: userMutedRef.current,
      })

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
