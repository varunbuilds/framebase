import { useState } from 'react'
import { useWorkspace } from '@/lib/workspace/use-workspace'
import { chooseWorkspace, reconnectWorkspace } from '@/lib/workspace/workspace-manager'

export function WorkspaceBar() {
  const workspace = useWorkspace()
  const [pending, setPending] = useState(false)

  const choose = async () => {
    setPending(true)
    try {
      await chooseWorkspace()
    } finally {
      setPending(false)
    }
  }

  const reconnect = async () => {
    setPending(true)
    try {
      await reconnectWorkspace()
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mb-8 rounded-lg border border-fb-border bg-fb-panel px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium text-fb-text">Local workspace</h2>
          <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-fb-muted">
            {workspace.status === 'unsupported'
              ? 'This browser cannot use a local workspace folder. Open Framebase in Chrome or Arc.'
              : workspace.status === 'ready'
                ? 'Framebase stores your local project media and editing files in this folder.'
                : 'Choose a local workspace. Framebase uses this folder to store your local project media and editing files.'}
          </p>
          {workspace.folderName ? (
            <p className="mt-2 text-[12px] text-fb-text">{workspace.folderName}</p>
          ) : null}
          {workspace.error ? (
            <p className="mt-2 text-[12px] text-fb-danger">{workspace.error}</p>
          ) : null}
        </div>
        {workspace.status === 'ready' ? (
          <button
            type="button"
            onClick={() => void choose()}
            disabled={pending}
            className="h-8 rounded-md border border-fb-border px-3 text-[12px] text-fb-text hover:bg-white/[0.06] disabled:opacity-50"
          >
            {pending ? 'Opening…' : 'Change'}
          </button>
        ) : workspace.status === 'needs-permission' ? (
          <button
            type="button"
            onClick={() => void reconnect()}
            disabled={pending}
            className="h-8 rounded-md bg-white px-3 text-[12px] font-medium text-black disabled:opacity-50"
          >
            {pending ? 'Opening…' : 'Reconnect workspace'}
          </button>
        ) : workspace.status === 'none' ? (
          <button
            type="button"
            onClick={() => void choose()}
            disabled={pending}
            className="h-8 rounded-md bg-white px-3 text-[12px] font-medium text-black disabled:opacity-50"
          >
            {pending ? 'Opening…' : 'Choose workspace'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
