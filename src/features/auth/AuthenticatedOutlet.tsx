import { useEffect, useRef } from 'react'
import { Outlet, useRouter } from '@tanstack/react-router'
import { shouldRefreshForAccountChange } from '@/features/auth/route-loading'
import { useAuth } from '@/features/auth/use-auth'
import { useEditorStore } from '@/stores/editor-store'

/** Drops the previous account's editor state and reloads protected routes. */
export function AuthenticatedOutlet() {
  const { user } = useAuth()
  const router = useRouter()
  const previousUserId = useRef<string | null>(null)
  useEffect(() => {
    const nextUserId = user?.id ?? null
    if (shouldRefreshForAccountChange(previousUserId.current, nextUserId)) {
      useEditorStore.getState().endEditingSession()
      void router.invalidate()
    }
    previousUserId.current = nextUserId
  }, [router, user?.id])
  return <Outlet />
}
