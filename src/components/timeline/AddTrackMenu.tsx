import { Film, Music2, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/stores/editor-store'
import type { TrackKind } from '@/types/timeline'

const options: Array<{ kind: TrackKind; label: string; Icon: typeof Film }> = [
  { kind: 'video', label: 'Video track', Icon: Film },
  { kind: 'audio', label: 'Audio track', Icon: Music2 },
]

/** Stays in the track-header corner. Choosing a kind adds that lane. */
export function AddTrackMenu() {
  const addTrack = useEditorStore((state) => state.addTrack)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative flex h-full w-full items-center justify-center">
      <button
        type="button"
        aria-label="Add track"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add track"
        onClick={() => setOpen((current) => !current)}
        className={`track-add-trigger ${open ? 'is-open' : ''}`}
      >
        <Plus size={14} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="track-add-menu" role="menu" aria-label="Add track">
          {options.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className="track-add-option"
              onClick={() => {
                addTrack(kind)
                setOpen(false)
              }}
            >
              <Icon size={14} strokeWidth={1.6} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
