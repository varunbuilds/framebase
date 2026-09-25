import { useState } from 'react'
import { TopToolbar } from '@/components/layout/TopToolbar'
import { MediaPanel } from '@/components/media/MediaPanel'
import { PreviewPanel } from '@/components/preview/PreviewPanel'
import { TimelinePanel } from '@/components/timeline/TimelinePanel'
import {
  Captions,
  FolderOpen,
  LayoutGrid,
  Mic,
  Music2,
  Type,
  type LucideIcon,
} from 'lucide-react'

type SidebarTool = 'media' | 'layouts' | 'audio' | 'captions' | 'voice' | 'text'

const tools: Array<{ id: SidebarTool; label: string; Icon: LucideIcon }> = [
  { id: 'media', label: 'Media', Icon: FolderOpen },
  { id: 'layouts', label: 'Layouts', Icon: LayoutGrid },
  { id: 'audio', label: 'Audio', Icon: Music2 },
  { id: 'captions', label: 'Captions', Icon: Captions },
  { id: 'voice', label: 'Voice', Icon: Mic },
  { id: 'text', label: 'Text', Icon: Type },
]

function ToolPanel({
  label,
  Icon,
}: {
  label: string
  Icon: LucideIcon
}) {
  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-fb-panel">
      <div className="flex h-11 shrink-0 items-center px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fb-muted">
          {label}
        </h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Icon size={20} className="text-fb-subtle" strokeWidth={1.5} />
        <p className="text-[12px] font-medium text-fb-text">{label}</p>
      </div>
    </aside>
  )
}

const SIDEBAR_WIDTH = 360

export function EditorShell() {
  const [tool, setTool] = useState<SidebarTool>('media')
  const [open, setOpen] = useState(true)
  const activeTool = tools.find((item) => item.id === tool) ?? tools[0]

  const selectTool = (id: SidebarTool) => {
    if (id === tool) {
      setOpen((current) => !current)
      return
    }
    setTool(id)
    setOpen(true)
  }

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-fb-app text-fb-text">
      <TopToolbar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <nav
            className="flex w-16 shrink-0 flex-col items-center gap-2 overflow-hidden border-r border-fb-border bg-fb-panel pt-4"
            aria-label="Editor tools"
          >
            {tools.map(({ id, label, Icon }) => {
              const selected = open && tool === id
              return (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => selectTool(id)}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${selected ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:bg-white/[0.05] hover:text-white/75'}`}
                >
                  <Icon size={18} strokeWidth={1.6} />
                </button>
              )
            })}
          </nav>
          <div
            className="h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
            style={{ width: open ? SIDEBAR_WIDTH : 0 }}
          >
            <div
              className="h-full border-r border-fb-border"
              style={{ width: SIDEBAR_WIDTH }}
            >
              {activeTool.id === 'media' ? (
                <MediaPanel />
              ) : (
                <ToolPanel label={activeTool.label} Icon={activeTool.Icon} />
              )}
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <PreviewPanel />
          </div>
        </div>
        <TimelinePanel />
      </div>
    </div>
  )
}
