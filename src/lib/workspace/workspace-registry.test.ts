import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import switcherSource from '../../components/projects/WorkspaceSwitcher.tsx?raw'
import accessSource from '../../components/projects/WorkspaceAccess.tsx?raw'
import { createMemoryDirectory } from './memory-directory'
import {
  createMemoryWorkspaceHandleStore,
  readSelectedHandle,
  WORKSPACE_HANDLE_KEY,
  WORKSPACE_REGISTRY_KEY,
} from './workspace-handle-store'
import { knownWorkspaceViews } from './workspace-registry'
import type { StoredDirectoryHandle } from './workspace-restore'
import {
  associateWorkspaceHandle,
  forgetKnownWorkspace,
  getConnectedProjectIds,
  getKnownWorkspaces,
  getWorkspaceSnapshot,
  listConnectedWorkspaceProjects,
  mirrorCurrentProject,
  releaseWorkspaceConnection,
  selectWorkspaceDirectory,
  setWorkspaceHandleStore,
  switchToKnownWorkspace,
} from './workspace-manager'

const TESTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function folderHandle(
  name: string,
  permission: PermissionState,
): StoredDirectoryHandle {
  return {
    name,
    queryPermission: async () => permission,
    requestPermission: async () => permission,
  }
}

describe('workspace registry', () => {
  afterEach(() => {
    releaseWorkspaceConnection()
    setWorkspaceHandleStore(null)
  })

  it('keeps a legacy selected handle and does not invent a registry entry', async () => {
    const store = createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
    const legacy = folderHandle('Framebase', 'granted')
    await store.write(legacy)
    expect(await store.read()).toBe(legacy)
    expect(await store.list()).toEqual([])
    expect(readSelectedHandle(legacy)).toBe(legacy)
    expect(readSelectedHandle({ entries: [] })).toBeNull()
    expect(WORKSPACE_HANDLE_KEY).toBe('selected')
    expect(WORKSPACE_REGISTRY_KEY).toBe('workspaces')
  })

  it('dedupes by workspace id and switches the project list with the folder', async () => {
    const store = createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
    setWorkspaceHandleStore(store)
    const original = createMemoryDirectory('Original')
    const next = createMemoryDirectory('Next')
    const originalHandle = folderHandle('Original', 'granted')
    const nextHandle = folderHandle('Next', 'granted')

    expect(await selectWorkspaceDirectory(original, originalHandle)).toBe(true)
    const originalId = getWorkspaceSnapshot().workspaceId
    await mirrorCurrentProject(createEmptyProject('tester', TESTER_ID))
    expect(await selectWorkspaceDirectory(next, nextHandle)).toBe(true)
    const nextId = getWorkspaceSnapshot().workspaceId
    expect(await listConnectedWorkspaceProjects()).toEqual([])
    expect(getConnectedProjectIds()).toEqual([])
    expect((await store.list()).map((entry) => entry.workspaceId).sort()).toEqual(
      [originalId, nextId].sort(),
    )

    expect(await selectWorkspaceDirectory(original, originalHandle)).toBe(true)
    expect((await store.list()).filter((entry) => entry.workspaceId === originalId)).toHaveLength(1)
    expect(await switchToKnownWorkspace(nextId!)).toBe(true)
    expect(getWorkspaceSnapshot().workspaceId).toBe(nextId)
    expect(await listConnectedWorkspaceProjects()).toEqual([])
    expect(await switchToKnownWorkspace(originalId!)).toBe(true)
    expect((await listConnectedWorkspaceProjects()).map((project) => project.name)).toEqual([
      'tester',
    ])
    expect(getKnownWorkspaces().find((item) => item.workspaceId === originalId)?.active).toBe(true)
  })

  it('leaves the current workspace in place when permission is denied', async () => {
    const store = createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
    setWorkspaceHandleStore(store)
    const original = createMemoryDirectory('Original')
    await original.writeFile('notes.txt', new Blob(['keep']))
    const originalHandle = folderHandle('Original', 'granted')
    expect(await selectWorkspaceDirectory(original, originalHandle)).toBe(true)
    const originalId = getWorkspaceSnapshot().workspaceId
    const denied = folderHandle('Other', 'denied')
    await store.saveEntry({
      workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      handle: denied,
      name: 'Other',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      availability: 'available',
    })

    expect(await switchToKnownWorkspace('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(false)
    expect(getWorkspaceSnapshot().workspaceId).toBe(originalId)
    expect(getWorkspaceSnapshot().status).toBe('ready')
    expect(getWorkspaceSnapshot().error).toContain('permission')
    expect(await (await original.readFile('notes.txt'))!.text()).toBe('keep')
    expect(
      (await store.list()).find((entry) => entry.name === 'Other')?.availability,
    ).toBe('needs-permission')
  })

  it('marks an inaccessible workspace unavailable and can remove it without deleting files', async () => {
    const store = createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
    setWorkspaceHandleStore(store)
    const original = createMemoryDirectory('Original')
    const missing = createMemoryDirectory('Missing')
    await missing.writeFile('keep.txt', new Blob(['stay']))
    const originalHandle = folderHandle('Original', 'granted')
    const missingHandle = folderHandle('Missing', 'granted')
    associateWorkspaceHandle(missingHandle, missing)
    expect(await selectWorkspaceDirectory(original, originalHandle)).toBe(true)
    const originalId = getWorkspaceSnapshot().workspaceId
    const missingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await store.saveEntry({
      workspaceId: missingId,
      handle: missingHandle,
      name: 'Missing',
      lastUsedAt: '2026-01-02T00:00:00.000Z',
      availability: 'available',
    })

    expect(await switchToKnownWorkspace(missingId)).toBe(false)
    expect(getWorkspaceSnapshot().workspaceId).toBe(originalId)
    expect((await store.list()).find((entry) => entry.workspaceId === missingId)?.availability).toBe(
      'unavailable',
    )
    expect(await (await missing.readFile('keep.txt'))!.text()).toBe('stay')

    await forgetKnownWorkspace(missingId)
    expect(await store.list()).toHaveLength(1)
    expect((await store.list())[0]?.workspaceId).toBe(originalId)
    expect(await (await missing.readFile('keep.txt'))!.text()).toBe('stay')
    expect(getWorkspaceSnapshot().workspaceId).toBe(originalId)
  })

  it('numbers workspaces that share a display name', () => {
    const views = knownWorkspaceViews(
      [
        {
          workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Cuts',
          lastUsedAt: '2026-02-02T00:00:00.000Z',
          availability: 'available',
        },
        {
          workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Cuts',
          lastUsedAt: '2026-01-01T00:00:00.000Z',
          availability: 'available',
        },
      ],
      { workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Cuts' },
    )
    expect(views.map((item) => item.name)).toEqual(['Cuts (1)', 'Cuts (2)'])
    expect(views[0]?.active).toBe(true)
    expect(switcherSource).toContain('Add workspace…')
    expect(switcherSource).toContain('chooseWorkspace')
    expect(accessSource).not.toContain('Change')
  })
})
