import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import {
  AuthScreen,
  authButtonClass,
  authFieldClass,
} from '@/components/auth/AuthScreen'
import { useAuth } from '@/features/auth/use-auth'
import { isProjectId } from '@/features/projects/document'

export function LoginPage() {
  const { signIn, status } = useAuth()
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/login' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await signIn(email.trim(), password)
      const projectId = redirect.startsWith('/editor/')
        ? redirect.slice('/editor/'.length)
        : ''
      if (isProjectId(projectId)) {
        await navigate({ to: '/editor/$projectId', params: { projectId } })
        return
      }
      await navigate({ to: '/projects' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthScreen
      title="Sign in"
      footer={
        <>
          No account?{' '}
          <Link to="/signup" className="text-fb-text">
            Create one
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
        <label className="flex flex-col gap-1.5 text-[12px] text-fb-muted">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={authFieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-fb-muted">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={authFieldClass}
          />
        </label>
        {status === 'unconfigured' && (
          <p className="text-[13px] text-fb-danger">
            Supabase is not configured in this environment.
          </p>
        )}
        {error && <p className="text-[13px] text-fb-danger">{error}</p>}
        <button type="submit" disabled={pending} className={authButtonClass}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthScreen>
  )
}
