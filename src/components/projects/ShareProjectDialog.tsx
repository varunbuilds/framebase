import { useEffect, useId, useState } from 'react'
import { readShareToken } from '@/features/projects/share-access'
import {
  createProjectShareLink,
  projectShareLinkActive,
  revokeProjectShareLink,
  shareLinkUrl,
} from '@/features/projects/sharing'

export function ShareProjectDialog({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const titleId = useId()
  const remembered =
    typeof sessionStorage === 'undefined' ? null : readShareToken(sessionStorage, projectId)
  const [createdFor, setCreatedFor] = useState(projectId)
  const [created, setCreated] = useState<string | null>(null)
  if (createdFor !== projectId) {
    setCreatedFor(projectId)
    setCreated(null)
  }
  const token = created ?? remembered
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  useEffect(() => {
    let cancelled = false
    void projectShareLinkActive(projectId)
      .then((isActive) => {
        if (!cancelled) setActive(isActive)
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load the share link.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const create = async () => {
    setPending(true)
    setError(null)
    setCopied(false)
    try {
      const next = await createProjectShareLink(projectId)
      setCreated(next)
      setActive(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a share link.')
    } finally {
      setPending(false)
    }
  }

  const revoke = async () => {
    setPending(true)
    setError(null)
    try {
      await revokeProjectShareLink(projectId)
      setCreated(null)
      setActive(false)
      setCopied(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke the share link.')
    } finally {
      setPending(false)
    }
  }

  const copy = async () => {
    if (!token) return
    const url = shareLinkUrl(window.location.origin, token)
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  const url = token ? shareLinkUrl(window.location.origin, token) : ''

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[440px] rounded-xl border border-fb-border bg-fb-panel p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-[16px] font-semibold text-fb-text">
          Share project
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fb-muted">
          Anyone with this link can edit this project.
        </p>
        {url ? (
          <p className="mt-4 break-all rounded-md border border-fb-border bg-fb-app px-3 py-2 text-[12px] text-fb-text">
            {url}
          </p>
        ) : active ? (
          <p className="mt-4 text-[13px] leading-relaxed text-fb-muted">
            A link is already active. Create a new link to copy it. The current link will stop
            working.
          </p>
        ) : (
          <p className="mt-4 text-[13px] text-fb-muted">No share link yet.</p>
        )}
        {error && <p className="mt-3 text-[12px] text-fb-danger">{error}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {active && (
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={pending}
              className="mr-auto h-8 px-2 text-[12px] text-fb-muted hover:text-fb-text disabled:opacity-50"
            >
              Revoke link
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-8 rounded-md border border-fb-border px-3 text-[12px] text-fb-text hover:bg-white/[0.06] disabled:opacity-50"
          >
            Close
          </button>
          {url && (
            <button
              type="button"
              onClick={() => void copy()}
              disabled={pending}
              className="h-8 rounded-md border border-fb-border px-3 text-[12px] text-fb-text hover:bg-white/[0.06] disabled:opacity-50"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void create()}
            disabled={pending}
            className="h-8 rounded-md bg-white px-3 text-[12px] font-medium text-black disabled:opacity-50"
          >
            {pending ? 'Working…' : active || url ? 'Create new link' : 'Create link'}
          </button>
        </div>
      </div>
    </div>
  )
}
