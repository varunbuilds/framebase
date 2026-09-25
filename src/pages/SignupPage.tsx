import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import {
  AuthScreen,
  authButtonClass,
  authFieldClass,
} from '@/components/auth/AuthScreen'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { useAuth } from '@/features/auth/use-auth'

export function SignupPage() {
  const { signUp, status } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setPending(true)
    try {
      const result = await signUp(email.trim(), password)
      if (result.needsEmailConfirmation) {
        setNotice('Check your email to confirm the account, then sign in.')
        return
      }
      await navigate({ to: '/projects' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create account.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthScreen
      title="Create account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" search={{ redirect: '' }} className="text-fb-text">
            Sign in
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
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={authFieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-fb-muted">
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={authFieldClass}
          />
        </label>
        {status === 'unconfigured' && (
          <p className="text-[13px] text-fb-danger">
            Supabase is not configured in this environment.
          </p>
        )}
        {error && <p className="text-[13px] text-fb-danger">{error}</p>}
        {notice && <p className="text-[13px] text-fb-muted">{notice}</p>}
        <button type="submit" disabled={pending} className={authButtonClass}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <div className="mt-4">
        <GoogleSignInButton disabled={pending} />
      </div>
    </AuthScreen>
  )
}
