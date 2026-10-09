import { useState } from 'react'
import { useWorkspace } from '@/lib/workspace/use-workspace'
import { chooseWorkspace, reconnectWorkspace } from '@/lib/workspace/workspace-manager'
import { reconnectWorkspaceForLibrary } from '@/lib/workspace/project-library'

export function WorkspaceAccess() {
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
      await reconnectWorkspaceForLibrary(() => reconnectWorkspace())
    } finally {
      setPending(false)
    }
  }

  const folder = workspace.folderName ?? 'this folder'
  const settled = workspace.status === 'ready' || workspace.status === 'restoring'
  if (settled) return null

  return (
    <section className="app-panel mb-8 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium text-fb-text">Local workspace</h2>
          {workspace.status === 'restoring' && (
            <p className="mt-2 text-[13px] text-fb-muted">Restoring workspace…</p>
          )}
          {workspace.status === 'unsupported' && (
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-fb-muted">
              This browser cannot use a local workspace folder. Open Framebase in Chrome or Arc.
            </p>
          )}
          {workspace.status === 'none' && (
            <>
              <p className="mt-2 text-[13px] text-fb-text">No workspace connected.</p>
              <p className="mt-1 text-[13px] text-fb-muted">
                Select a workspace folder to use Framebase.
              </p>
            </>
          )}
          {workspace.status === 'needs-permission' && (
            <>
              <p className="mt-2 text-[13px] text-fb-muted">Framebase previously used:</p>
              <p className="mt-1 text-[13px] text-fb-text">{folder}</p>
              <p className="mt-2 text-[13px] text-fb-muted">
                Workspace access needs to be restored.
              </p>
            </>
          )}
          {workspace.status === 'ready' && (
            <>
              <p className="mt-2 text-[13px] text-fb-text">{folder}</p>
              <p className="mt-1 text-[13px] text-fb-muted">Workspace ready.</p>
            </>
          )}
          {workspace.error ? (
            <p className="mt-2 text-[12px] text-fb-danger">{workspace.error}</p>
          ) : null}
        </div>
        {workspace.status === 'needs-permission' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void reconnect()}
              disabled={pending}
              className="app-btn disabled:opacity-50"
            >
              {pending ? 'Opening…' : 'Reconnect'}
            </button>
            {workspace.error ? (
              <button
                type="button"
                onClick={() => void choose()}
                disabled={pending}
                className="app-btn-quiet disabled:opacity-50"
              >
                Select workspace
              </button>
            ) : null}
          </div>
        ) : workspace.status === 'none' ? (
          <button
            type="button"
            onClick={() => void choose()}
            disabled={pending}
            className="app-btn disabled:opacity-50"
          >
            {pending ? 'Opening…' : 'Select workspace'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
