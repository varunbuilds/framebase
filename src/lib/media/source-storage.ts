import { getSupabase } from '@/lib/supabase/client'
import {
  CloudMediaError,
  SOURCE_MEDIA_BUCKET,
  isSourceStoragePath,
  type SourceStorageClient,
} from './cloud-media'

export type StorageSession = {
  accessToken: string
  supabaseUrl: string
  anonKey: string
}

const loggedOut = () => new CloudMediaError('logged-out', 'Sign in to use cloud media.')

function authHeaders(session: StorageSession): Record<string, string> {
  return {
    authorization: `Bearer ${session.accessToken}`,
    apikey: session.anonKey,
  }
}

function objectUrl(session: StorageSession, path: string): string {
  const encoded = path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const base = session.supabaseUrl.replace(/\/$/, '')
  return `${base}/storage/v1/object/${encodeURIComponent(SOURCE_MEDIA_BUCKET)}/${encoded}`
}

function assertSourcePath(path: string): void {
  if (!isSourceStoragePath(path)) {
    throw new CloudMediaError('failed', 'Only original source media can be stored in the cloud.')
  }
}

function failureForStatus(status: number): CloudMediaError {
  if (status === 401) return new CloudMediaError('logged-out', 'Sign in to use cloud media.')
  if (status === 403) return new CloudMediaError('denied', 'You do not have access to this media.')
  return new CloudMediaError('failed', 'Cloud media request failed.')
}

async function postBlob(args: {
  url: string
  headers: Record<string, string>
  body: Blob
  fetchImpl: typeof fetch
  onProgress?: (loaded: number, total: number) => void
}): Promise<void> {
  if (args.onProgress && typeof XMLHttpRequest !== 'undefined') {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', args.url)
      for (const [key, value] of Object.entries(args.headers)) {
        xhr.setRequestHeader(key, value)
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) args.onProgress?.(event.loaded, event.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(failureForStatus(xhr.status))
      }
      xhr.onerror = () => reject(new CloudMediaError('failed', 'Cloud media upload failed.'))
      xhr.send(args.body)
    })
    return
  }

  const response = await args.fetchImpl(args.url, {
    method: 'POST',
    headers: args.headers,
    body: args.body,
  })
  if (!response.ok) throw failureForStatus(response.status)
}

export function createSourceStorageClient(options: {
  readSession: () => Promise<StorageSession | null>
  fetchImpl?: typeof fetch
}): SourceStorageClient {
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async upload({ path, body, contentType, onProgress }) {
      assertSourcePath(path)
      const session = await options.readSession()
      if (!session?.accessToken) throw loggedOut()
      const headers = {
        ...authHeaders(session),
        'content-type': contentType || 'application/octet-stream',
        'x-upsert': 'true',
      }
      await postBlob({
        url: objectUrl(session, path),
        headers,
        body,
        fetchImpl,
        onProgress,
      })
    },

    async download(path) {
      assertSourcePath(path)
      const session = await options.readSession()
      if (!session?.accessToken) throw loggedOut()
      const response = await fetchImpl(objectUrl(session, path), {
        headers: authHeaders(session),
      })
      if (!response.ok) throw failureForStatus(response.status)
      return response.blob()
    },

    async remove(paths) {
      const session = await options.readSession()
      if (!session?.accessToken) throw loggedOut()
      for (const path of paths) {
        assertSourcePath(path)
        const response = await fetchImpl(objectUrl(session, path), {
          method: 'DELETE',
          headers: authHeaders(session),
        })
        if (response.status === 404) continue
        if (!response.ok) throw failureForStatus(response.status)
      }
    },
  }
}

export async function readBrowserStorageSession(): Promise<StorageSession | null> {
  const { data, error } = await getSupabase().auth.getSession()
  if (error || !data.session) return null
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return null
  return {
    accessToken: data.session.access_token,
    supabaseUrl,
    anonKey,
  }
}

export function browserSourceStorage(): SourceStorageClient {
  return createSourceStorageClient({ readSession: readBrowserStorageSession })
}
