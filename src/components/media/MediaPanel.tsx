import { Film, Music2, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { importLocalMediaFile, MEDIA_ACCEPT } from '@/lib/media/import'
import { beginMediaDrag, endMediaDrag } from '@/lib/media/media-drag'
import { getObjectUrl } from '@/lib/media/object-urls'
import { useEditorStore } from '@/stores/editor-store'

export function MediaPanel() {
  const mediaSources = useEditorStore((state) => state.document.mediaSources)
  const selectedMediaSourceId = useEditorStore(
    (state) => state.ui.selectedMediaSourceId,
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none p-2">
        {mediaSources.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            <Film size={20} className="text-fb-subtle" strokeWidth={1.5} />
            <p className="text-[12px] font-medium text-fb-text">Import your media here.</p>
            <p className="text-[11px] leading-relaxed text-fb-muted">
              Drag files or use the Import button to add media here.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {mediaSources.map((source) => {
              const selected = source.id === selectedMediaSourceId
              const objectUrl = getObjectUrl(source.id)
              return (
                <li key={source.id}>
                  <div
                    className={`group relative rounded-md border p-1 ${
                      selected
                        ? 'border-fb-accent/60 bg-fb-accent-soft'
                        : 'border-transparent hover:border-fb-border hover:bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        beginMediaDrag(source.id, event.dataTransfer)
                      }}
                      onDragEnd={() => endMediaDrag()}
                      onClick={() => selectMediaSource(source.id)}
                      onDoubleClick={() => addClip(source.id)}
                      title="Drag onto the timeline, or double-click to append"
                      className="block w-full cursor-grab text-left active:cursor-grabbing"
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
