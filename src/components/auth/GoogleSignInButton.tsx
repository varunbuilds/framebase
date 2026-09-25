import { useState } from 'react'
import { signInWithGoogle } from '@/features/auth/google'
import { useAuth } from '@/features/auth/use-auth'

function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.2-4.1 5.5l.1.1 6.3 5.3C39.2 37.4 44 32 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  )
}

export function GoogleSignInButton({
  redirectTo,
  disabled = false,
}: {
  redirectTo?: string
  disabled?: boolean
}) {
  const { status } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setError(null)
    setPending(true)
    try {
      await signInWithGoogle(redirectTo)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start Google sign-in.')
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-fb-subtle">
        <span className="h-px flex-1 bg-fb-border" />
        or
        <span className="h-px flex-1 bg-fb-border" />
      </div>
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || pending || status === 'unconfigured'}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-fb-border-strong bg-fb-surface text-[13px] font-medium text-fb-text hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <GoogleMark />
        {pending ? 'Continuing to Google…' : 'Continue with Google'}
      </button>
      {error && <p className="text-[13px] text-fb-danger">{error}</p>}
    </div>
  )
}
