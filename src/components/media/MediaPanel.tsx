import { Film, Music2, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { importLocalMediaFile, MEDIA_ACCEPT } from '@/lib/media/import'
import { beginMediaDrag, endMediaDrag } from '@/lib/media/media-drag'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'

const MARQUEE_SLOP_PX = 4

function rectsIntersect(
  item: DOMRect,
  marquee: { left: number; top: number; right: number; bottom: number },
) {
  return (
    item.left < marquee.right &&
    item.right > marquee.left &&
    item.top < marquee.bottom &&
    item.bottom > marquee.top
  )
}

export function MediaPanel() {
  const mediaSources = useEditorStore((state) => state.document.mediaSources)
  const selectedMediaSourceIds = useEditorStore(
    (state) => state.ui.selectedMediaSourceIds,
  )
  const importError = useEditorStore((state) => state.ui.importError)
  const importStatus = useEditorStore((state) => state.ui.importStatus)
  const selectMediaSource = useEditorStore((state) => state.selectMediaSource)
  const registerMediaSource = useEditorStore((state) => state.registerMediaSource)
  const unregisterMediaSource = useEditorStore(
    (state) => state.unregisterMediaSource,
  )
  const addClip = useEditorStore((state) => state.addClip)
  const setImportError = useEditorStore((state) => state.setImportError)
  const setImportStatus = useEditorStore((state) => state.setImportStatus)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const anchorIdRef = useRef<string | null>(null)
  const marqueeSessionRef = useRef<{
    pointerId: number
    originX: number
    originY: number
    additive: boolean
    base: string[]
    moved: boolean
  } | null>(null)
  const [marquee, setMarquee] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  const panelOrder = (ids: Iterable<string>) => {
    const wanted = new Set(ids)
    return mediaSources
      .map((source) => source.id)
      .filter((id) => wanted.has(id))
  }

  const sameSelection = (next: string[]) =>
    next.length === selectedMediaSourceIds.length &&
    next.every((id, index) => id === selectedMediaSourceIds[index])

  const applySelection = (next: string[]) => {
    if (sameSelection(next)) return
    selectMediaSource(next)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setImportStatus('importing')
    setImportError(null)

    for (const file of Array.from(files)) {
      const result = await importLocalMediaFile(file)
      if (!result.ok) {
        setImportError(result.error)
        continue
      }
      registerMediaSource(result.source)
    }

    setImportStatus('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onPanelPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('[data-media-item]')) return
    const additive = event.metaKey || event.ctrlKey || event.shiftKey
    marqueeSessionRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      additive,
      base: additive ? selectedMediaSourceIds : [],
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPanelPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = marqueeSessionRef.current
    if (!session || event.pointerId !== session.pointerId) return
    const dx = event.clientX - session.originX
    const dy = event.clientY - session.originY
    if (!session.moved && Math.hypot(dx, dy) < MARQUEE_SLOP_PX) return
    session.moved = true

    const bounds = {
      left: Math.min(session.originX, event.clientX),
      top: Math.min(session.originY, event.clientY),
      right: Math.max(session.originX, event.clientX),
      bottom: Math.max(session.originY, event.clientY),
    }
    const hits: string[] = []
    for (const [id, element] of itemRefs.current) {
      if (rectsIntersect(element.getBoundingClientRect(), bounds)) hits.push(id)
    }
    const orderedHits = panelOrder(hits)
    const seen = new Set(session.base)
    applySelection(
      session.additive
        ? [...session.base, ...orderedHits.filter((id) => !seen.has(id))]
        : orderedHits,
    )

    const host = panelRef.current
    if (!host) return
    const hostBounds = host.getBoundingClientRect()
    setMarquee({
      left: bounds.left - hostBounds.left + host.scrollLeft,
      top: bounds.top - hostBounds.top + host.scrollTop,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    })
  }

  const endMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = marqueeSessionRef.current
    if (!session || event.pointerId !== session.pointerId) return
    if (!session.moved && !session.additive) {
      applySelection([])
      anchorIdRef.current = null
    }
    marqueeSessionRef.current = null
    setMarquee(null)
  }

  const onItemClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (event.metaKey || event.ctrlKey) {
      const next = selectedMediaSourceIds.includes(id)
        ? selectedMediaSourceIds.filter((item) => item !== id)
        : [...selectedMediaSourceIds, id]
      applySelection(next)
      anchorIdRef.current = id
      return
    }

    if (event.shiftKey && anchorIdRef.current) {
      const ids = mediaSources.map((source) => source.id)
      const start = ids.indexOf(anchorIdRef.current)
      const end = ids.indexOf(id)
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start]
        applySelection(ids.slice(from, to + 1))
        return
      }
    }

    applySelection([id])
    anchorIdRef.current = id
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-fb-panel">
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Media
        </h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importStatus === 'importing'}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.07] px-2 text-[11px] font-medium text-fb-text hover:bg-white/[0.12] disabled:opacity-50"
        >
          <Plus size={12} strokeWidth={2} />
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          className="sr-only"
          aria-label="Import media files"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      <div
        ref={panelRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-none p-2"
        onPointerDown={onPanelPointerDown}
        onPointerMove={onPanelPointerMove}
        onPointerUp={endMarquee}
        onPointerCancel={endMarquee}
      >
        {mediaSources.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            <Film size={20} className="text-fb-subtle" strokeWidth={1.5} />
            <p className="text-[12px] font-medium text-fb-text">Import your media here.</p>
            <p className="text-[11px] leading-relaxed text-fb-muted">
              Drag files or use the Import button to add media here.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 select-none">
            {mediaSources.map((source) => {
              const selected = selectedMediaSourceIds.includes(source.id)
              const objectUrl = getObjectUrl(source.id)
              return (
                <li
                  key={source.id}
                  data-media-item
                  ref={(node) => {
                    if (node) itemRefs.current.set(source.id, node)
                    else itemRefs.current.delete(source.id)
                  }}
                >
                  <div
                    className={`group relative rounded-md border p-1 ${
                      selected
                        ? 'border-fb-accent/70 bg-fb-accent-soft'
                        : 'border-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        const ids = selectedMediaSourceIds.includes(source.id)
                          ? selectedMediaSourceIds
                          : [source.id]
                        if (!selectedMediaSourceIds.includes(source.id)) {
                          selectMediaSource([source.id])
                          anchorIdRef.current = source.id
                        }
                        beginMediaDrag(ids, event.dataTransfer)
                      }}
                      onDragEnd={() => endMediaDrag()}
                      onClick={(event) => onItemClick(event, source.id)}
                      onDoubleClick={() => addClip(source.id)}
                      title="Click to select. Command-click or drag a box to select more, then drag the group onto the timeline."
                      className="block w-full cursor-default text-left"
                    >
                      <span className="relative block aspect-video overflow-hidden rounded-[5px] border border-white/[0.08] bg-[#181e22]">
                        {source.kind === 'video' && objectUrl ? (
                          <video
                            src={objectUrl}
                            className="pointer-events-none h-full w-full object-cover"
                            muted
                            preload="metadata"
                            draggable={false}
                            aria-hidden
                          />
                        ) : (
                          <span className="absolute inset-0 flex items-center justify-center text-fb-muted">
                            {source.kind === 'video' ? (
                              <Film size={22} strokeWidth={1.5} />
                            ) : (
                              <Music2 size={22} strokeWidth={1.5} />
                            )}
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 flex items-center gap-1 truncate px-0.5 text-[11px] font-medium text-fb-text">
                        <span className="truncate">{source.name}</span>
                        {source.hasVideo && source.hasAudio && (
                          <span
                            className="shrink-0 rounded bg-white/[0.08] px-1 text-[9px] font-semibold uppercase tracking-wide text-fb-muted"
                            title="Contains video and audio"
                          >
                            A/V
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => unregisterMediaSource(source.id)}
                        aria-label={`Remove ${source.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded bg-black/45 text-fb-muted hover:bg-red-50 hover:text-fb-danger"
                      >
                        <Trash2 size={12} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {marquee && (
          <div
            className="pointer-events-none absolute z-10 border border-fb-accent/80 bg-fb-accent/15"
            style={{
              left: marquee.left,
              top: marquee.top,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}
      </div>

      {(importError || importStatus === 'importing') && (
        <div className="border-t border-fb-border px-3 py-2">
          {importStatus === 'importing' && (
            <p className="text-[11px] text-fb-muted">Importing media…</p>
          )}
          {importError && (
            <p className="text-[11px] leading-snug text-fb-danger" role="alert">
              {importError}
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
