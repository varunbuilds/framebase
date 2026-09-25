import { describe, expect, it } from 'vitest'
import { googleCallbackUrl, oauthCallbackMessage, safeAuthRedirect } from './redirect'

const projectId = '22222222-2222-4222-8222-222222222222'

describe('safeAuthRedirect', () => {
  it('defaults empty and external targets to /projects', () => {
    expect(safeAuthRedirect(undefined)).toBe('/projects')
    expect(safeAuthRedirect('')).toBe('/projects')
    expect(safeAuthRedirect('https://evil.example/projects')).toBe('/projects')
    expect(safeAuthRedirect('//evil.example')).toBe('/projects')
    expect(safeAuthRedirect('/login')).toBe('/projects')
    expect(safeAuthRedirect(`/editor/${projectId}/extra`)).toBe('/projects')
  })

  it('keeps a project page and an editor id', () => {
    expect(safeAuthRedirect('/projects')).toBe('/projects')
    expect(safeAuthRedirect(`/editor/${projectId}`)).toBe(`/editor/${projectId}`)
    expect(safeAuthRedirect(`/editor/${projectId}?x=1`)).toBe(`/editor/${projectId}`)
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
})

describe('oauthCallbackMessage', () => {
  it('explains cancel and invalid codes', () => {
    expect(oauthCallbackMessage('access_denied')).toBe('Google sign-in was cancelled.')
    expect(oauthCallbackMessage('invalid_request', 'code expired')).toBe(
      'This Google sign-in link is invalid or has expired. Try again.',
    )
  })
})
