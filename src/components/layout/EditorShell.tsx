import { InspectorPanel } from '@/components/inspector/InspectorPanel'
import { TopToolbar } from '@/components/layout/TopToolbar'
import { MediaPanel } from '@/components/media/MediaPanel'
import { PreviewPanel } from '@/components/preview/PreviewPanel'
import { TimelinePanel } from '@/components/timeline/TimelinePanel'

export function EditorShell() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-fb-app text-fb-text">
      <TopToolbar />
      <div className="flex min-h-0 flex-1">
        <MediaPanel />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <PreviewPanel />
            <InspectorPanel />
          </div>
          <TimelinePanel />
        </div>
      </div>
    </div>
  )
}
