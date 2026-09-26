import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AuthScreen, authButtonClass } from '@/components/auth/AuthScreen'
import { useAuth } from '@/features/auth/use-auth'
import {
  previewProjectShareLink,
  redeemProjectShareLink,
} from '@/features/projects/sharing'
import { isShareToken, shareJoinPath } from '@/features/projects/share-access'

const joinRoute = getRouteApi('/join/$token')

export function JoinPage() {
  const { token } = joinRoute.useParams()
  const { status } = useAuth()
  const navigate = useNavigate()
  const tokenValid = isShareToken(token)
  const [phase, setPhase] = useState<'checking' | 'invalid' | 'signed-out'>('checking')
  const display = tokenValid ? phase : 'invalid'

  useEffect(() => {
    if (!tokenValid) return
    if (status === 'loading') return
    let active = true
    if (status !== 'signed-in') {
      void previewProjectShareLink(token).then((valid) => {
        if (active) setPhase(valid ? 'signed-out' : 'invalid')
      })
      return () => {
        active = false
      }
    }
    void redeemProjectShareLink(token)
      .then((projectId) => {
        if (!active) return
        void navigate({
          to: '/editor/$projectId',
          params: { projectId },
          replace: true,
        })
      })
      .catch(() => {
        if (active) setPhase('invalid')
      })
    return () => {
      active = false
    }
  }, [navigate, status, token, tokenValid])

  const redirect = isShareToken(token) ? shareJoinPath(token) : ''

  return (
    <AuthScreen
      title={display === 'invalid' ? 'Link unavailable' : 'Join project'}
      footer={
        <Link to="/projects" className="text-fb-text">
          Projects
        </Link>
      }
    >
      {display === 'checking' && (
        <p className="text-[13px] text-fb-muted">Checking this share link…</p>
      )}
      {display === 'invalid' && (
        <p className="text-[13px] text-fb-text">This share link is no longer valid.</p>
      )}
      {display === 'signed-out' && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-fb-muted">
            Sign in to join this project. You will be able to edit it.
          </p>
          <Link
            to="/login"
            search={{ redirect }}
            className={`${authButtonClass} no-underline`}
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            search={{ redirect }}
            className="text-center text-[13px] text-fb-text no-underline"
          >
            Create account
          </Link>
        </div>
      )}
    </AuthScreen>
  )
}
