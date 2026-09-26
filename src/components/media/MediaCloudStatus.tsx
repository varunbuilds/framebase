import type { MediaSource } from '@/types/timeline'
import { describeCloudMedia } from '@/lib/media/cloud-media'
import { useCloudTransfer } from '@/lib/media/cloud-transfer'
import { beginCloudDownload, beginCloudUpload } from '@/lib/media/publish-source'
import { getObjectUrl } from '@/lib/media/object-urls'

export function MediaCloudStatus({ source }: { source: MediaSource }) {
  const transfer = useCloudTransfer(source.id)
  const local = Boolean(getObjectUrl(source.id)) || source.availability === 'available'
  const view = describeCloudMedia({
    local,
    remote: Boolean(source.remote),
    transfer,
  })

  return (
    <div className="mt-1 flex items-center gap-1 px-0.5 text-[10px] text-fb-subtle">
      <span className="truncate">{view.text}</span>
      {view.action === 'download' && (
        <button
          type="button"
          className="shrink-0 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-fb-text hover:bg-white/[0.14]"
          onClick={() => beginCloudDownload(source)}
        >
          Download
        </button>
      )}
      {view.action === 'upload' && (
        <button
          type="button"
          className="shrink-0 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-fb-text hover:bg-white/[0.14]"
          onClick={() => beginCloudUpload(source)}
        >
          Upload
        </button>
      )}
      {transfer?.phase === 'error' && transfer.message && (
        <span className="truncate text-fb-danger" title={transfer.message}>
          {transfer.message}
        </span>
      )}
    </div>
  )
}
