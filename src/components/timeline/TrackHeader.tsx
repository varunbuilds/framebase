import { Film, Lock, LockOpen, Music2, Power, Trash2 } from 'lucide-react'
import { TIMELINE_TRACK_HEIGHT } from '@/features/collab/timeline-cursor'
import { useEditorStore } from '@/stores/editor-store'
import type { Track } from '@/types/timeline'

export function TrackHeader({ track }: { track: Track }) {
  const setTrackMuted = useEditorStore((state) => state.setTrackMuted)
  const setTrackLocked = useEditorStore((state) => state.setTrackLocked)
  const removeTrack = useEditorStore((state) => state.removeTrack)
  const clipCount = useEditorStore(
    (state) => state.document.clips.filter((clip) => clip.trackId === track.id).length,
  )
  const Icon = track.kind === 'video' ? Film : Music2
  const disableLabel = track.muted ? 'Enable track' : 'Disable track'

  return (
    <div
      className="flex flex-col justify-center gap-1.5 border-b border-fb-border bg-fb-panel px-1.5"
      style={{ height: TIMELINE_TRACK_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-fb-text">
        <Icon size={12} strokeWidth={1.6} className="shrink-0 text-fb-muted" />
        <span className="truncate" title={track.name}>
          {track.name}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={disableLabel}
          aria-pressed={track.muted}
          title={
            track.muted
              ? 'Enable track'
              : track.kind === 'video'
                ? 'Disable track. Its video will not show.'
                : 'Disable track. Its audio will not play.'
          }
          onClick={() => setTrackMuted(track.id, !track.muted)}
          className={`track-header-btn ${track.muted ? 'is-active' : ''}`}
        >
          <Power size={12} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={track.locked ? 'Unlock track' : 'Lock track'}
          aria-pressed={track.locked}
          title={track.locked ? 'Unlock track' : 'Lock track'}
          onClick={() => setTrackLocked(track.id, !track.locked)}
          className={`track-header-btn ${track.locked ? 'is-active' : ''}`}
        >
          {track.locked ? (
            <Lock size={12} strokeWidth={1.75} />
          ) : (
            <LockOpen size={12} strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          aria-label={clipCount > 0 ? `Delete ${track.name} and its clips` : `Delete ${track.name}`}
          title={
            clipCount > 0
              ? 'Delete track and its clips. Undo restores them.'
              : 'Delete track'
          }
          onClick={() => removeTrack(track.id)}
          className="track-header-btn"
        >
          <Trash2 size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
