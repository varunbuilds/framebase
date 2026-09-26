import { Link, getRouteApi } from '@tanstack/react-router'
import {
  Circle,
  Download,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ShareProjectDialog } from '@/components/projects/ShareProjectDialog'
import { useAuth } from '@/features/auth/use-auth'
import { projectAccessRole } from '@/features/projects/share-access'
import {
  isProjectSaveShortcut,
  projectSaveShortcutLabel,
} from '@/features/editor/shortcuts'
import { useEditorHistory, useEditorStore } from '@/stores/editor-store'
import { stepPlayheadMs } from '@/utils/time'

const editorRoute = getRouteApi('/authenticated/editor/$projectId')

export function TopToolbar() {
  const project = editorRoute.useLoaderData()
  const { user } = useAuth()
  const projectName = useEditorStore((state) => state.document.name)
  const setProjectName = useEditorStore((state) => state.setProjectName)
  const saveStatus = useEditorStore((state) => state.ui.saveStatus)
  const lastSavedAt = useEditorStore((state) => state.ui.lastSavedAt)
  const requestSave = useEditorStore((state) => state.requestSave)
  const saveError = useEditorStore((state) => state.ui.saveError)
  const togglePlayback = useEditorStore((state) => state.togglePlayback)
  const seekTo = useEditorStore((state) => state.seekTo)
  const pause = useEditorStore((state) => state.pause)
  const { undo, redo, canUndo, canRedo } = useEditorHistory()
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(projectName)
  const inputRef = useRef<HTMLInputElement>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const canShare = projectAccessRole(project.ownerId, user?.id) === 'owner'

  useEffect(() => {
    if (editingName) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editingName])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typingInField =
        target != null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (isProjectSaveShortcut(event) && !event.repeat) {
        event.preventDefault()
        event.stopPropagation()
        if (editingName) {
          const next = draftName.trim()
          if (next) setProjectName(next)
          setEditingName(false)
        }
        requestSave()
        return
      }

      if (
        (event.code === 'Space' || event.key === ' ') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (typingInField) return
        event.preventDefault()
        event.stopPropagation()
        const active = globalThis.document.activeElement
        if (active instanceof HTMLElement && active !== globalThis.document.body) {
          active.blur()
        }
        togglePlayback()
        return
      }

      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (typingInField) return
        event.preventDefault()
        const { isPlaying, playheadMs } = useEditorStore.getState().ui
        if (isPlaying) pause()
        const frames = event.key === 'ArrowLeft' ? -1 : 1
        seekTo(stepPlayheadMs(playheadMs, frames))
        return
      }

      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        if (canUndo) undo()
      }
      if (
        (event.key.toLowerCase() === 'z' && event.shiftKey) ||
        event.key.toLowerCase() === 'y'
      ) {
        event.preventDefault()
        if (canRedo) redo()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    canUndo,
    canRedo,
    draftName,
    editingName,
    pause,
    redo,
    requestSave,
    seekTo,
    setProjectName,
    togglePlayback,
    undo,
  ])

  const beginEditingName = () => {
    setDraftName(projectName)
    setEditingName(true)
  }

  const commitName = () => {
    const next = draftName.trim()
    if (next) setProjectName(next)
    else setDraftName(projectName)
    setEditingName(false)
  }

  const statusLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'error'
        ? saveError
          ? `Save failed · ${saveError}`
          : 'Save failed'
        : saveStatus === 'saved'
          ? lastSavedAt
            ? `Saved · ${new Date(lastSavedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : 'Saved'
          : 'Unsaved changes'

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-fb-border bg-fb-panel px-4">
      <Link
        to="/projects"
        className="flex items-center gap-2 pr-2 no-underline"
        title="Projects"
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[11px] font-bold tracking-tight text-black"
          aria-hidden
        >
          F
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-fb-text">
          Framebase
        </span>
      </Link>

      <div className="h-4 w-px bg-fb-border" aria-hidden />

      {editingName ? (
        <input
          ref={inputRef}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitName()
            if (event.key === 'Escape') {
              setDraftName(projectName)
              setEditingName(false)
            }
          }}
          aria-label="Project name"
          className="h-7 min-w-[160px] rounded border border-fb-border-strong bg-fb-app px-2 text-[13px] text-fb-text caret-fb-text scheme-dark"
        />
      ) : (
        <button
          type="button"
          onClick={beginEditingName}
          className="h-7 rounded px-2 text-left text-[13px] font-medium text-fb-text hover:bg-white/[0.06]"
          title="Rename project"
        >
          {projectName}
        </button>
      )}

      <div className="flex items-center gap-1.5 text-[12px] text-fb-muted">
        <Circle
          size={8}
          className={
            saveStatus === 'saved'
              ? 'fill-emerald-500 text-emerald-500'
              : saveStatus === 'error'
                ? 'fill-fb-danger text-fb-danger'
                : 'fill-amber-500 text-amber-500'
          }
          aria-hidden
        />
        <span>{statusLabel}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => requestSave()}
          title={`Save (${projectSaveShortcutLabel()})`}
          className="h-7 rounded-md border border-fb-border bg-white/[0.06] px-2.5 text-[12px] font-medium text-fb-text hover:bg-white/[0.1]"
        >
          Save
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="h-7 rounded-md border border-fb-border bg-white/[0.06] px-2.5 text-[12px] font-medium text-fb-text hover:bg-white/[0.1]"
          >
            Share
          </button>
        )}
        <button
          type="button"
          disabled
          title="Export is not implemented in this milestone"
          aria-label="Export (not implemented)"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[12px] font-medium text-fb-subtle"
        >
          <Download size={13} strokeWidth={1.75} />
          Export
          <span className="text-[10px] uppercase tracking-wide">Soon</span>
        </button>
      </div>
      {shareOpen && (
        <ShareProjectDialog projectId={project.id} onClose={() => setShareOpen(false)} />
      )}
    </header>
  )
}
