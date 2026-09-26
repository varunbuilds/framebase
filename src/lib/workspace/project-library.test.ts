import { describe, expect, it } from 'vitest'
import projectsSource from '../../pages/ProjectsPage.tsx?raw'
import workspaceAccessSource from '../../components/projects/WorkspaceAccess.tsx?raw'
import { restoreStoredWorkspace, type StoredDirectoryHandle } from '@/lib/workspace/workspace-restore'
import { createMemoryWorkspaceHandleStore } from '@/lib/workspace/workspace-handle-store'
import { openOrCreateWorkspace } from '@/lib/workspace/workspace-layout'
import { createMemoryDirectory } from '@/lib/workspace/memory-directory'
import {
  reconnectWorkspaceForLibrary,
  showsProjectLibrary,
} from '@/lib/workspace/project-library'

function folderHandle(
  name: string,
  permission: 'granted' | 'prompt',
): StoredDirectoryHandle {
  return {
    name,
    queryPermission: async () => permission,
    requestPermission: async () => {
      throw new Error('requestPermission must wait for Reconnect')
    },
  }
}

describe('project library workspace gate', () => {
  it('hides the project list until the workspace is ready', () => {
    expect(showsProjectLibrary('none')).toBe(false)
    expect(showsProjectLibrary('needs-permission')).toBe(false)
    expect(showsProjectLibrary('restoring')).toBe(false)
    expect(showsProjectLibrary('unsupported')).toBe(false)
    expect(showsProjectLibrary('ready')).toBe(true)
    expect(projectsSource).toContain('showsProjectLibrary')
    expect(projectsSource).toContain('library ?')
  })

  it('restores a saved handle when permission is already granted', async () => {
    const root = createMemoryDirectory('My Framebase Workspace')
    await openOrCreateWorkspace(root)
    const store = createMemoryWorkspaceHandleStore<StoredDirectoryHandle>()
    await store.write(folderHandle('My Framebase Workspace', 'granted'))
    const restored = await restoreStoredWorkspace({
      readHandle: () => store.read(),
      openDirectory: async () => root,
    })
    expect(restored.status).toBe('ready')
    expect(showsProjectLibrary(restored.status === 'ready' ? 'ready' : 'none')).toBe(true)
  })

  it('shows reconnect when a saved workspace still needs permission', async () => {
    const restored = await restoreStoredWorkspace({
      readHandle: async () => folderHandle('My Framebase Workspace', 'prompt'),
      openDirectory: async () => createMemoryDirectory('My Framebase Workspace'),
    })
    expect(restored.status).toBe('needs-permission')
    expect(showsProjectLibrary('needs-permission')).toBe(false)
    expect(workspaceAccessSource).toContain('Reconnect')
    expect(workspaceAccessSource).toContain('Framebase previously used:')
    expect(workspaceAccessSource).toContain('Select workspace')
    expect(workspaceAccessSource).toContain('No workspace connected.')
    expect(workspaceAccessSource).toContain('Workspace ready.')
    expect(workspaceAccessSource).toContain('Restoring workspace…')
    expect(workspaceAccessSource).toContain('This browser cannot use a local workspace folder')
  })

  it('loads the project library in place after reconnect', async () => {
    const routes: string[] = []
    const next = await reconnectWorkspaceForLibrary(async () => true)
    expect(next).toBe('projects')
    expect(showsProjectLibrary('ready')).toBe(true)
    expect(routes).toEqual([])
    expect(workspaceAccessSource).not.toContain('navigate(')
  })
})
