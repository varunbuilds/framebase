import { TopToolbar } from '@/components/layout/TopToolbar'
import { MediaPanel } from '@/components/media/MediaPanel'
import { PreviewPanel } from '@/components/preview/PreviewPanel'
import { TimelinePanel } from '@/components/timeline/TimelinePanel'
import { Captions, FolderOpen, LayoutGrid, Mic, Music2, Type } from 'lucide-react'

const tools = [
  { label: 'Media', Icon: FolderOpen, active: true },
  { label: 'Layouts', Icon: LayoutGrid },
  { label: 'Audio', Icon: Music2 },
  { label: 'Captions', Icon: Captions },
  { label: 'Voice', Icon: Mic },
  { label: 'Text', Icon: Type },
]

export function EditorShell() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-fb-app text-fb-text">
      <TopToolbar />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-fb-border bg-fb-panel pt-4" aria-label="Editor tools">
            {tools.map(({ label, Icon, active }) => (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${active ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:bg-white/[0.05] hover:text-white/75'}`}
              >
                <Icon size={18} strokeWidth={1.6} />
              </button>
            ))}
          </nav>
          <MediaPanel />
          <div className="flex min-h-0 min-w-0 flex-1">
            <PreviewPanel />
          </div>
        </div>
        <TimelinePanel />
      </div>
    </div>
  )
}
