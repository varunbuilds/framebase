import { Film, Music2, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { importLocalMediaFile, MEDIA_ACCEPT } from '@/lib/media/import'
import { useEditorStore } from '@/stores/editor-store'
import { formatDurationShort } from '@/utils/time'

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
    <aside className="flex h-full min-h-0 w-[240px] shrink-0 flex-col border-r border-fb-border bg-fb-panel">
      <div className="flex h-9 items-center justify-between border-b border-fb-border px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          Media
        </h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importStatus === 'importing'}
          className="inline-flex h-6 items-center gap-1 rounded border border-fb-border bg-white px-2 text-[11px] font-medium text-fb-text hover:bg-fb-app disabled:opacity-50"
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

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {mediaSources.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            <Film size={20} className="text-fb-subtle" strokeWidth={1.5} />
            <p className="text-[12px] font-medium text-fb-text">No media yet</p>
            <p className="text-[11px] leading-relaxed text-fb-muted">
              Import local video or audio files. Files stay in this browser
              session and are not uploaded.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {mediaSources.map((source) => {
              const selected = source.id === selectedMediaSourceId
              return (
                <li key={source.id}>
                  <div
                    className={`group rounded border px-2 py-2 ${
                      selected
                        ? 'border-fb-accent/40 bg-fb-accent-soft'
                        : 'border-transparent hover:border-fb-border hover:bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectMediaSource(source.id)}
                      className="flex w-full items-start gap-2 text-left"
                    >
                      <span className="mt-0.5 text-fb-muted">
                        {source.kind === 'video' ? (
                          <Film size={14} strokeWidth={1.75} />
                        ) : (
                          <Music2 size={14} strokeWidth={1.75} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-fb-text">
                          {source.name}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-fb-muted">
                          {source.kind} · {formatDurationShort(source.durationMs)}
                          {source.width && source.height
                            ? ` · ${source.width}×${source.height}`
                            : ''}
                        </span>
                      </span>
                    </button>
                    <div className="mt-1.5 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => addClip(source.id)}
                        className="h-6 rounded border border-fb-border bg-white px-1.5 text-[10px] font-medium text-fb-text hover:bg-fb-app"
                      >
                        Add to timeline
                      </button>
                      <button
                        type="button"
                        onClick={() => unregisterMediaSource(source.id)}
                        aria-label={`Remove ${source.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-fb-muted hover:bg-red-50 hover:text-fb-danger"
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
