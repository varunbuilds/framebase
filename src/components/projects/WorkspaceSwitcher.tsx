import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, Folder } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace/use-workspace'
import {
  chooseWorkspace,
  forgetKnownWorkspace,
  getKnownWorkspaces,
  subscribeWorkspace,
  switchToKnownWorkspace,
} from '@/lib/workspace/workspace-manager'

export function WorkspaceSwitcher({ disabled = false }: { disabled?: boolean }) {
  const workspace = useWorkspace()
  const known = useSyncExternalStore(subscribeWorkspace, getKnownWorkspaces, getKnownWorkspaces)
  const [open, setOpen] = useState(false)
  const [present, setPresent] = useState(false)
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const label = workspace.folderName ?? 'No workspace'

  useEffect(() => {
    if (open) {
      setPresent(true)
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
      return () => cancelAnimationFrame(frame)
    }
    setVisible(false)
    const timer = window.setTimeout(() => setPresent(false), 220)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const addWorkspace = async () => {
    setPending(true)
    try {
      await chooseWorkspace()
    } finally {
      setPending(false)
      setOpen(false)
    }
  }

  const selectWorkspace = async (workspaceId: string, active: boolean) => {
    if (active || pending) return
    setPending(true)
    try {
      await switchToKnownWorkspace(workspaceId)
    } finally {
      setPending(false)
    }
  }

  return (
    <div ref={rootRef} className="relative flex self-stretch">
      <button
        type="button"
        disabled={disabled || pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className="workspace-trigger h-full min-h-[36px]"
      >
        <Folder size={14} strokeWidth={1.7} className="shrink-0 text-[rgba(243,244,244,0.72)]" />
        <span>{pending ? 'Opening…' : label}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.7}
          className={`workspace-trigger-chevron shrink-0 text-[rgba(243,244,244,0.72)] ${open ? 'is-open' : ''}`}
        />
      </button>
      {present ? (
        <div
          id={menuId}
          role="menu"
          aria-hidden={!visible}
          className={`workspace-menu rounded-md border border-white/10 bg-[#141414] py-1 shadow-lg ${visible ? 'is-open' : ''}`}
        >
          {known.map((item) => (
            <div key={item.workspaceId} className="px-1">
              <button
                type="button"
                role="menuitem"
                disabled={pending || item.availability !== 'available'}
                onClick={() => void selectWorkspace(item.workspaceId, item.active)}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[13px] text-[#f4f4f4] hover:bg-white/[0.06] disabled:hover:bg-transparent"
              >
                <Folder size={14} strokeWidth={1.7} className="shrink-0 text-[rgba(243,244,244,0.55)]" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.active ? <Check size={14} strokeWidth={1.8} className="text-fb-accent" /> : null}
              </button>
              {item.availability !== 'available' ? (
                <div className="flex items-center gap-2 px-2 pb-2">
                  <span className="text-[11px] text-fb-muted">
                    {item.availability === 'needs-permission' ? 'Permission needed' : 'Unavailable'}
                  </span>
                  <button
                    type="button"
                    className="app-btn-quiet h-7 px-2"
                    onClick={() => void selectWorkspace(item.workspaceId, false)}
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    className="app-btn-quiet h-7 px-2"
                    onClick={() => void forgetKnownWorkspace(item.workspaceId)}
                  >
                    Remove
                  </button>
                </div>
              ) : item.active ? null : (
                <div className="px-2 pb-1">
                  <button
                    type="button"
                    className="app-btn-quiet h-7 px-2"
                    onClick={() => void forgetKnownWorkspace(item.workspaceId)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="my-1 border-t border-white/10" />
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-[13px] text-[#f4f4f4] hover:bg-white/[0.06]"
            onClick={() => void addWorkspace()}
          >
            Add workspace…
          </button>
          {workspace.error ? (
            <p className="px-3 py-2 text-[12px] text-fb-danger">{workspace.error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
