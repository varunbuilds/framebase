import { describe, expect, it } from 'vitest'
import vercelConfig from '../../../vercel.json'
import routerSource from '../../router.tsx?raw'
import {
  classifyOAuthCallback,
  completeOAuthCallback,
} from './oauth-callback'

const ORIGIN = 'https://framebase.varunrewadi.com/auth/callback'

function authDouble() {
  const calls: string[] = []
  return {
    calls,
    auth: {
      async getSession() {
        calls.push('getSession')
        return { data: { session: { user: { id: 'user' } } }, error: null }
      },
      async exchangeCodeForSession(code: string) {
        calls.push(`exchange:${code}`)
        return { data: { session: { user: { id: 'user' } } }, error: null }
      },
    },
  }
}

describe('oauth callback plan', () => {
  it('treats a fragment session as implicit and does not exchange a code', async () => {
    const href = `${ORIGIN}?code=auth-code#access_token=secret-access&refresh_token=secret-refresh&expires_in=3600&token_type=bearer`
    expect(classifyOAuthCallback(href)).toEqual({ kind: 'implicit' })
    expect(JSON.stringify(classifyOAuthCallback(href))).not.toContain('secret-access')
    expect(JSON.stringify(classifyOAuthCallback(href))).not.toContain('secret-refresh')

    const { auth, calls } = authDouble()
    await expect(completeOAuthCallback(auth, href)).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['getSession'])
  })

  it('exchanges a PKCE code only when the fragment has no session', async () => {
    const href = `${ORIGIN}?code=auth-code`
    expect(classifyOAuthCallback(href)).toEqual({ kind: 'pkce', code: 'auth-code' })
    const { auth, calls } = authDouble()
    await expect(completeOAuthCallback(auth, href)).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['exchange:auth-code'])
  })

  it('reports a fragment error without repeating token material', () => {
    const href = `${ORIGIN}#error=access_denied&error_description=User%20denied%20access_token%3Dsecret-access`
    const plan = classifyOAuthCallback(href)
    expect(plan.kind).toBe('error')
    if (plan.kind !== 'error') return
    expect(plan.message).toBe('Google sign-in was cancelled.')
    expect(plan.message).not.toContain('secret-access')
  })

  it('fails closed when the callback has neither a session nor a code', async () => {
    const { auth, calls } = authDouble()
    await expect(completeOAuthCallback(auth, ORIGIN)).resolves.toEqual({
      ok: false,
      message: 'Google did not return a sign-in session. Try again.',
    })
    expect(calls).toEqual([])
  })
})

describe('auth callback route and hosting', () => {
  it('registers /auth/callback in the production route tree', () => {
    expect(routerSource).toContain("path: '/auth/callback'")
    expect(routerSource).toContain('authCallbackRoute')
  })

  it('rewrites /auth/callback to the Vite app on every host', () => {
    const rewrite = vercelConfig.rewrites[0]
    expect(rewrite).toEqual({
      source: '/((?!assets/|favicon).*)',
      destination: '/index.html',
    })
    expect(rewrite?.source.includes('varunrewadi') || rewrite?.source.includes('varunbuilds')).toBe(
      false,
    )
    for (const path of ['/auth/callback', '/login', '/assets/index.js', '/favicon-32x32.png']) {
      const matched = new RegExp(`^${rewrite?.source}$`).test(path)
      expect(matched).toBe(path === '/auth/callback' || path === '/login')
    }
  })
})
