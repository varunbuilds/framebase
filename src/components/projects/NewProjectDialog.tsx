import { useEffect, useId, useState } from 'react'
import type { CanvasAspectRatio } from '@/types/timeline'

const RATIOS: {
  value: CanvasAspectRatio
  label: string
  hint: string
  width: number
  height: number
}[] = [
  { value: '16:9', label: '16:9', hint: 'Landscape', width: 32, height: 18 },
  { value: '9:16', label: '9:16', hint: 'Portrait', width: 18, height: 32 },
  { value: '1:1', label: '1:1', hint: 'Square', width: 24, height: 24 },
  { value: '4:3', label: '4:3', hint: 'Standard', width: 28, height: 21 },
]

export function NewProjectDialog({
  creating,
  onCancel,
  onCreate,
}: {
  creating: boolean
  onCancel: () => void
  onCreate: (project: { name: string; aspectRatio: CanvasAspectRatio }) => void
}) {
  const titleId = useId()
  const nameId = useId()
  const [name, setName] = useState('Untitled Project')
  const [aspectRatio, setAspectRatio] = useState<CanvasAspectRatio>('16:9')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [creating, onCancel])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a project name.')
      return
    }
    setError(null)
    onCreate({ name: trimmed, aspectRatio })
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 px-4 py-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[440px] rounded-lg border border-fb-border bg-fb-panel p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-[16px] font-semibold text-fb-text">
          New Project
        </h2>
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!creating) submit()
          }}
        >
          <label htmlFor={nameId} className="text-[12px] text-fb-muted">
            Project name
          </label>
          <input
            id={nameId}
            value={name}
            autoFocus
            disabled={creating}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1.5 h-9 w-full rounded-md border border-fb-border-strong bg-fb-surface px-3 text-[13px] text-fb-text outline-none"
          />

          <p className="mt-5 text-[12px] text-fb-muted">Aspect ratio</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {RATIOS.map((ratio) => {
              const selected = ratio.value === aspectRatio
              return (
                <button
                  key={ratio.value}
                  type="button"
                  disabled={creating}
                  aria-pressed={selected}
                  onClick={() => setAspectRatio(ratio.value)}
                  className={`flex h-[92px] flex-col items-center justify-center gap-2 rounded-md border px-1 ${
                    selected
                      ? 'border-fb-accent bg-fb-accent-soft'
                      : 'border-fb-border bg-fb-surface hover:border-fb-border-strong'
                  }`}
                >
                  <span className="flex h-9 w-9 items-center justify-center">
                    <span
                      className={`rounded-[3px] border ${
                        selected ? 'border-fb-accent bg-fb-accent/30' : 'border-fb-muted/70'
                      }`}
                      style={{ width: ratio.width, height: ratio.height }}
                    />
                  </span>
                  <span className="text-center leading-tight">
                    <span className="block text-[12px] font-medium text-fb-text">
                      {ratio.label}
                    </span>
                    <span className="block text-[10px] text-fb-subtle">{ratio.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {error && (
            <p className="mt-3 text-[12px] text-fb-danger" role="alert">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={creating}
              className="h-9 rounded-md px-3 text-[13px] text-fb-muted hover:text-fb-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="h-9 rounded-md bg-white px-3 text-[13px] font-medium text-black disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
