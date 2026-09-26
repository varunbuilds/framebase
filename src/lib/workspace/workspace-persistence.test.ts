import { describe, expect, it } from 'vitest'
import authSource from '@/features/auth/auth-context.tsx?raw'
import sharingSql from '../../../supabase/migrations/20260926200000_project_sharing.sql?raw'
import { createEmptyProject } from '@/features/editor/project'
import { durableProjectPayload } from '@/features/projects/document'
import { describeCloudMedia, remoteReference } from '@/lib/media/cloud-media'
import { hydrateDocumentMedia } from '@/lib/media/hydrate-project-media'
import { createMemoryMediaStore } from '@/lib/media/memory-media-store'
import {
  canDeleteProject,
  canManageShareLink,
  projectAccessRole,
  projectCollaborationRoomId,
  rememberShareToken,
  roleAfterShareRedeem,
} from '@/features/projects/share-access'
import { createResolvingMediaStore } from '@/lib/workspace/resolving-store'
import type { MediaSource } from '@/types/timeline'
import { useEditorStore } from '@/stores/editor-store'
import { createMemoryDirectory } from './memory-directory'
import {
  createMemoryWorkspaceHandleStore,
  WORKSPACE_HANDLE_KEY,
  WORKSPACE_HANDLE_STORE,
} from './workspace-handle-store'
import { releaseWorkspaceConnection } from './workspace-manager'
import { afterWorkspaceRestore, restoreStoredWorkspace, type StoredDirectoryHandle } from './workspace-restore'
import { openOrCreateWorkspace, workspaceMediaDirectory } from './workspace-layout'
import { createWorkspaceMediaStore } from './workspace-media-store'

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function source(id: string): MediaSource {
  return {
    id,
    name: 'clip.mp4',
    kind: 'video',
    hasVideo: true,
    hasAudio: false,
    durationMs: 1000,
    mimeType: 'video/mp4',
    locator: { kind: 'local', key: id },
    availability: 'known',
    remote: remoteReference(id, 3, '2026-02-02T00:00:00.000Z'),
    importedAt: '2026-01-01T00:00:00.000Z',
  }
}

function folderHandle(
  name: string,
  permission: PermissionState,
  onRequest?: () => void,
): StoredDirectoryHandle {
  return {
    name,
    queryPermission: async () => permission,
    requestPermission: async () => {
      onRequest?.()
      return permission
    },
  }
}

describe('workspace handle persistence', () => {
  it('stores and replaces only the directory handle', async () => {
    const store = createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
    expect(await store.read()).toBeNull()
    const first = folderHandle('Framebase', 'granted')
    const second = folderHandle('Other', 'granted')
    await store.write(first)
    expect(await store.read()).toBe(first)
    await store.write(second)
    expect(await store.read()).toBe(second)
    expect(store.records()).toEqual([first, second])
    expect(JSON.stringify(store.records())).not.toContain('source-bytes')
    expect(WORKSPACE_HANDLE_STORE).toBe('directory-handle')
    expect(WORKSPACE_HANDLE_KEY).toBe('selected')
  })

  it('reports no workspace when no handle is saved', async () => {
    const result = await restoreStoredWorkspace({
      readHandle: async () => null,
      openDirectory: async () => {
        throw new Error('should not open')
      },
    })
    expect(result.status).toBe('none')
  })

  it('restores automatically when permission is already granted', async () => {
    const root = createMemoryDirectory('Framebase')
    await root.writeFile('notes.txt', new Blob(['keep me']))
    await openOrCreateWorkspace(root)
    let requested = false
    const handle = folderHandle('Framebase', 'granted', () => {
      requested = true
    })
    const result = await restoreStoredWorkspace({
      readHandle: async () => handle,
      openDirectory: async () => root,
    })
    expect(result.status).toBe('ready')
    expect(requested).toBe(false)
    expect(await (await root.readFile('notes.txt'))!.text()).toBe('keep me')
  })

  it('asks for reconnect when permission is not granted and does not request it', async () => {
    let requested = false
    const handle = folderHandle('Framebase', 'prompt', () => {
      requested = true
    })
    const result = await restoreStoredWorkspace({
      readHandle: async () => handle,
      openDirectory: async () => {
        throw new Error('should not open')
      },
    })
    expect(result).toEqual({ status: 'needs-permission', handle })
    expect(requested).toBe(false)
  })

  it('does not initialize or delete a folder that is not a workspace', async () => {
    const root = createMemoryDirectory('Downloads')
    await root.writeFile('notes.txt', new Blob(['keep me']))
    const result = await restoreStoredWorkspace({
      readHandle: async () => folderHandle('Downloads', 'granted'),
      openDirectory: async () => root,
    })
    expect(result.status).toBe('invalid')
    expect((await root.list()).map((entry) => entry.name)).toEqual(['notes.txt'])
  })

  it('keeps the saved handle when the editing session ends', async () => {
    const store = createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
    const handle = folderHandle('Framebase', 'granted')
    await store.write(handle)
    useEditorStore.getState().endEditingSession()
    releaseWorkspaceConnection()
    expect(await store.read()).toBe(handle)
    expect(authSource).not.toContain('workspace-handle-store')
    expect(authSource).not.toContain('indexedDB')
  })

  it('does not put the handle or a filesystem path in the project document', () => {
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source('media_a')]
    const payload = durableProjectPayload(document)
    const json = JSON.stringify(payload)
    expect(json).not.toContain('FileSystemDirectoryHandle')
    expect(json).not.toContain('/Users/')
    expect(json).not.toContain('directory-handle')
    expect(payload.document.mediaSources[0]?.locator).toEqual({
      kind: 'local',
      key: 'media_a',
    })
  })

  it('still prefers the workspace over legacy OPFS', async () => {
    const legacy = createMemoryMediaStore()
    const workspace = createMemoryMediaStore()
    await legacy.save('media_old', new Blob([Uint8Array.from([1])]), {
      name: 'old.mp4',
      mimeType: 'video/mp4',
    })
    await workspace.save('media_old', new Blob([Uint8Array.from([2, 2])]), {
      name: 'old.mp4',
      mimeType: 'video/mp4',
    })
    const resolving = createResolvingMediaStore({
      workspace: () => workspace,
      legacy,
      unavailableMessage: 'Choose a local workspace before importing media.',
    })
    expect((await resolving.get('media_old'))?.blob.size).toBe(2)
  })

  it('keeps cloud media separate from the local handle', () => {
    const media = source('media_a')
    expect(describeCloudMedia({ local: true, remote: true, transfer: null }).text).toBe('✓ Synced')
    expect(media.remote?.storagePath).toBe('media/media_a/source')
    expect(JSON.stringify(media.remote)).not.toContain('handle')
  })

  it('hydrates local media only after a granted workspace restore', async () => {
    const root = createMemoryDirectory('Framebase')
    await openOrCreateWorkspace(root)
    const media = createWorkspaceMediaStore(await workspaceMediaDirectory(root))
    await media.save('media_a', new Blob([Uint8Array.from([1, 2, 3])]), {
      name: 'clip.mp4',
      mimeType: 'video/mp4',
    })
    const document = createEmptyProject('Cut', PROJECT_ID)
    document.mediaSources = [source('media_a')]
    const order: string[] = []
    const hydrated = await afterWorkspaceRestore(
      async () => {
        order.push('restore')
        const restored = await restoreStoredWorkspace({
          readHandle: async () => folderHandle('Framebase', 'granted'),
          openDirectory: async () => root,
        })
        expect(restored.status).toBe('ready')
      },
      async () => {
        order.push('hydrate')
        return hydrateDocumentMedia(document, { store: media })
      },
    )
    expect(order).toEqual(['restore', 'hydrate'])
    expect(hydrated.document.mediaSources[0]?.availability).toBe('available')
  })
})

describe('project sharing access', () => {
  it('keeps owner control and editor access on one project', () => {
    expect(canDeleteProject('owner')).toBe(true)
    expect(canDeleteProject('editor')).toBe(false)
    expect(canManageShareLink('owner')).toBe(true)
    expect(canManageShareLink('editor')).toBe(false)
    expect(roleAfterShareRedeem('owner')).toBe('owner')
    expect(roleAfterShareRedeem(null)).toBe('editor')
    expect(roleAfterShareRedeem('editor')).toBe('editor')
    expect(projectAccessRole(PROJECT_ID, PROJECT_ID)).toBe('owner')
    expect(projectAccessRole(PROJECT_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe('editor')
    expect(projectCollaborationRoomId(PROJECT_ID)).toBe(PROJECT_ID)
  })

  it('remembers a share token outside the project document', () => {
    const storage = new Map<string, string>()
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    }
    const token = 'cd'.repeat(32)
    rememberShareToken(memory, PROJECT_ID, token)
    const json = JSON.stringify(durableProjectPayload(createEmptyProject('Cut', PROJECT_ID)))
    expect(json).not.toContain(token)
    expect([...storage.values()]).toEqual([token])
  })

  it('limits share redemption to a hashed token and membership', () => {
    expect(sharingSql).toContain('token_hash')
    expect(sharingSql).toContain("role in ('owner', 'editor')")
    expect(sharingSql).toContain('on conflict (project_id, user_id) do nothing')
    expect(sharingSql).toContain('revoke_project_share_link')
    expect(sharingSql).toContain('using (owner_id = auth.uid())')
    expect(sharingSql).toContain('security definer')
    expect(sharingSql).toContain('preview_project_share_link(text) to anon, authenticated')
    expect(sharingSql).not.toContain('redeem_project_share_link(text) to anon')
    expect(sharingSql).not.toContain('service_role')
    expect(sharingSql).toContain('room id is the project id')
    expect(sharingSql).toContain('can_access_project_media')
  })
})
