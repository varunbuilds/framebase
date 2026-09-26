import { getSupabase } from '@/lib/supabase/client'
import {
  forgetShareToken,
  isShareToken,
  rememberShareToken,
  shareJoinPath,
} from './share-access'

export class ShareLinkInvalidError extends Error {
  constructor() {
    super('This share link is no longer valid.')
    this.name = 'ShareLinkInvalidError'
  }
}

function requireToken(token: string): string {
  const trimmed = token.trim().toLowerCase()
  if (!isShareToken(trimmed)) throw new ShareLinkInvalidError()
  return trimmed
}

export async function createProjectShareLink(projectId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_project_share_link', {
    target_project_id: projectId,
  })
  if (error) throw error
  const token = typeof data === 'string' ? data : ''
  if (!isShareToken(token)) throw new Error('Could not create a share link.')
  if (typeof sessionStorage !== 'undefined') {
    rememberShareToken(sessionStorage, projectId, token)
  }
  return token
}

export async function revokeProjectShareLink(projectId: string): Promise<void> {
  const { error } = await getSupabase().rpc('revoke_project_share_link', {
    target_project_id: projectId,
  })
  if (error) throw error
  if (typeof sessionStorage !== 'undefined') forgetShareToken(sessionStorage, projectId)
}

export async function projectShareLinkActive(projectId: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('project_share_link_active', {
    target_project_id: projectId,
  })
  if (error) throw error
  return data === true
}

/** Does not reveal which project a token belongs to. */
export async function previewProjectShareLink(token: string): Promise<boolean> {
  let raw: string
  try {
    raw = requireToken(token)
  } catch {
    return false
  }
  const { data, error } = await getSupabase().rpc('preview_project_share_link', {
    raw_token: raw,
  })
  if (error) return false
  return data === true
}

/** Adds the signed-in user as an editor, unless they are already a member. */
export async function redeemProjectShareLink(token: string): Promise<string> {
  const raw = requireToken(token)
  const { data, error } = await getSupabase().rpc('redeem_project_share_link', {
    raw_token: raw,
  })
  if (error || typeof data !== 'string') throw new ShareLinkInvalidError()
  return data
}

export function shareLinkUrl(origin: string, token: string): string {
  return new URL(shareJoinPath(token), origin).toString()
}
