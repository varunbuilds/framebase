import { describe, expect, it } from 'vitest'
import { googleCallbackUrl, oauthCallbackMessage, safeAuthRedirect, authRedirectLocation } from './redirect'
import googleSource from './google.ts?raw'
import { isShareToken, shareJoinPath } from '@/features/projects/share-access'

const projectId = '22222222-2222-4222-8222-222222222222'
const token = 'ab'.repeat(32)

describe('safeAuthRedirect', () => {
  it('defaults empty and external targets to /projects', () => {
    expect(safeAuthRedirect(undefined)).toBe('/projects')
    expect(safeAuthRedirect('')).toBe('/projects')
    expect(safeAuthRedirect('https://evil.example/projects')).toBe('/projects')
    expect(safeAuthRedirect('//evil.example')).toBe('/projects')
    expect(safeAuthRedirect('/login')).toBe('/projects')
    expect(safeAuthRedirect(`/editor/${projectId}/extra`)).toBe('/projects')
    expect(safeAuthRedirect(`/join/${projectId}`)).toBe('/projects')
  })

  it('keeps a project page, an editor id, and a share token', () => {
    expect(safeAuthRedirect('/projects')).toBe('/projects')
    expect(safeAuthRedirect(`/editor/${projectId}`)).toBe(`/editor/${projectId}`)
    expect(safeAuthRedirect(`/editor/${projectId}?x=1`)).toBe(`/editor/${projectId}`)
    expect(isShareToken(token)).toBe(true)
    expect(safeAuthRedirect(shareJoinPath(token))).toBe(`/join/${token}`)
    expect(authRedirectLocation(shareJoinPath(token))).toEqual({
      to: '/join/$token',
      params: { token },
    })
  })
})

describe('google callback URL', () => {
  it('uses the app origin and only adds a safe redirect', () => {
    expect(googleCallbackUrl('https://framebase.test', undefined)).toBe(
      'https://framebase.test/auth/callback',
    )
    expect(googleCallbackUrl('https://framebase.test', 'https://evil.example')).toBe(
      'https://framebase.test/auth/callback',
    )
    expect(googleCallbackUrl('https://framebase.test', `/editor/${projectId}`)).toBe(
      `https://framebase.test/auth/callback?redirect=%2Feditor%2F${projectId}`,
    )
  })

  it('builds the callback on the origin where sign-in started', () => {
    const origins = [
      'https://framebase.varunrewadi.com',
      'https://framebase.varunbuilds.com',
      'http://localhost:5173',
    ]
    for (const origin of origins) {
      const callback = new URL(googleCallbackUrl(origin, `/editor/${projectId}`))
      expect(callback.origin).toBe(origin)
      expect(callback.pathname).toBe('/auth/callback')
      expect(authRedirectLocation(callback.searchParams.get('redirect'))).toEqual({
        to: '/editor/$projectId',
        params: { projectId },
      })
      expect(googleCallbackUrl(origin)).toBe(`${origin}/auth/callback`)
    }
    expect(googleSource).toContain('googleCallbackUrl(window.location.origin, next)')
  })
})

describe('oauthCallbackMessage', () => {
  it('explains cancel and invalid codes', () => {
    expect(oauthCallbackMessage('access_denied')).toBe('Google sign-in was cancelled.')
    expect(oauthCallbackMessage('invalid_request', 'code expired')).toBe(
      'This Google sign-in link is invalid or has expired. Try again.',
    )
  })
})
