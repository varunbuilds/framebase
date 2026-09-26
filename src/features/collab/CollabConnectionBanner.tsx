import { collabIndicator } from './collab-session'
import { useCollabSession } from './collab-session-context'

/**
 * Surfaces the collaborative states the editor cannot silently absorb:
 * reconnecting, offline with unsynced edits, and access or room failures.
 * Routine states (connecting, syncing, live) stay in the toolbar status.
 */
export function CollabConnectionBanner() {
  const session = useCollabSession()
  if (!session) return null
  const indicator = collabIndicator(session)
  if (!indicator.blocking) return null

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-fb-border bg-fb-panel px-4 py-2"
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          indicator.tone === 'error' ? 'bg-fb-danger' : 'bg-amber-500'
        }`}
      />
      <p
        className={`text-[12px] ${
          indicator.tone === 'error' ? 'text-fb-danger' : 'text-fb-muted'
        }`}
      >
        {indicator.label}
      </p>
    </div>
  )
}
