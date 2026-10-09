import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import projectsSource from '../../pages/ProjectsPage.tsx?raw'
import managerSource from './workspace-manager.ts?raw'
import { createMemoryDirectory } from './memory-directory'
import { createWorkspaceMediaStore } from './workspace-media-store'
import { listWorkspaceProjects } from './workspace-layout'
import {
  connectWorkspace,
  getConnectedProjectIds,
  getWorkspaceSnapshot,
  listConnectedWorkspaceProjects,
  mirrorCurrentProject,
  releaseWorkspaceConnection,
  subscribeWorkspace,
} from './workspace-manager'

const TESTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CREATED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CLOUD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('workspace switching', () => {
  afterEach(() => {
    releaseWorkspaceConnection()
  })

  it('lists only the connected folder, then the original folder again', async () => {
    const original = createMemoryDirectory('Original')
    const empty = createMemoryDirectory('Empty')
    await connectWorkspace(original)
    const tester = createEmptyProject('tester', TESTER_ID)
    await mirrorCurrentProject(tester)
    expect((await listConnectedWorkspaceProjects()).map((project) => project.name)).toEqual([
      'tester',
    ])

    const originalMarker = await (await original.readFile('.framebase-workspace.json'))!.text()
    const seen: string[][] = []
    const stop = subscribeWorkspace(() => {
      seen.push([...getConnectedProjectIds()])
    })
    await connectWorkspace(empty)
    stop()
    expect(seen[0]).toEqual([])
    expect(seen.at(-1)).toEqual([])
    expect(getWorkspaceSnapshot().folderName).toBe('Empty')
    expect(getWorkspaceSnapshot().workspaceId).not.toBe(
      JSON.parse(originalMarker).workspaceId,
    )
    expect(await listConnectedWorkspaceProjects()).toEqual([])
    const emptyIndex = JSON.parse(await (await empty.readFile('index.json'))!.text())
    expect(emptyIndex.projects).toEqual([])
    expect(await (await original.readFile('.framebase-workspace.json'))!.text()).toBe(originalMarker)
    expect((await listWorkspaceProjects(original)).map((project) => project.name)).toEqual([
      'tester',
    ])

    await connectWorkspace(original)
    expect(getWorkspaceSnapshot().folderName).toBe('Original')
    expect((await listConnectedWorkspaceProjects()).map((project) => project.id)).toEqual([
      TESTER_ID,
    ])
    expect(await listWorkspaceProjects(empty)).toEqual([])
  })

  it('creates a project in the newly selected workspace only', async () => {
    const original = createMemoryDirectory('Original')
    const next = createMemoryDirectory('Next')
    await connectWorkspace(original)
    await mirrorCurrentProject(createEmptyProject('tester', TESTER_ID))
    await connectWorkspace(next)
    await mirrorCurrentProject(createEmptyProject('fresh', CREATED_ID))

    expect((await listConnectedWorkspaceProjects()).map((project) => project.name)).toEqual([
      'fresh',
    ])
    expect((await listWorkspaceProjects(original)).map((project) => project.name)).toEqual([
      'tester',
    ])
    const created = await next.openDirectory('projects')
    const folder = await created!.openDirectory(CREATED_ID)
    expect(await folder!.readFile('project.json')).not.toBeNull()
    const originalProjects = await original.openDirectory('projects')
    expect(await originalProjects!.openDirectory(CREATED_ID, { create: false })).toBeNull()
  })

  it('mirrors an opened cloud project into the current workspace without copying the previous folder', async () => {
    const original = createMemoryDirectory('Original')
    const next = createMemoryDirectory('Next')
    await connectWorkspace(original)
    const media = createWorkspaceMediaStore(original)
    await media.save('media_a', new Blob([Uint8Array.from([7])]), {
      name: 'clip.mp4',
      mimeType: 'video/mp4',
    })
    await connectWorkspace(next)

    const cloud = createEmptyProject('cloud cut', CLOUD_ID)
    cloud.mediaSources = [
      {
        id: 'media_a',
        name: 'clip.mp4',
        kind: 'video',
        hasVideo: true,
        hasAudio: false,
        durationMs: 1000,
        mimeType: 'video/mp4',
        locator: { kind: 'local', key: 'media_a' },
        availability: 'known',
        importedAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    await mirrorCurrentProject(cloud)

    expect((await listConnectedWorkspaceProjects()).map((project) => project.id)).toEqual([
      CLOUD_ID,
    ])
    expect(await createWorkspaceMediaStore(next).has('media_a')).toBe(false)
    expect(await media.has('media_a')).toBe(true)
    expect(await listWorkspaceProjects(original)).toEqual([])
    const nextProjects = await next.openDirectory('projects')
    expect(await nextProjects!.openDirectory(CLOUD_ID)).not.toBeNull()
  })

  it('ignores a stale index and does not keep the previous directory after switching', async () => {
    const original = createMemoryDirectory('Original')
    const next = createMemoryDirectory('Next')
    await connectWorkspace(original)
    await mirrorCurrentProject(createEmptyProject('tester', TESTER_ID))
    await next.writeFile(
      'index.json',
      new Blob([
        JSON.stringify({
          version: 1,
          updatedAt: '2020-01-01T00:00:00.000Z',
          projects: [{ id: TESTER_ID, name: 'tester', updatedAt: '2020-01-01T00:00:00.000Z' }],
        }),
      ]),
    )

    await connectWorkspace(next)
    expect(await listConnectedWorkspaceProjects()).toEqual([])
    const index = JSON.parse(await (await next.readFile('index.json'))!.text())
    expect(index.projects).toEqual([])
    await mirrorCurrentProject(createEmptyProject('fresh', CREATED_ID))
    const written = await next.openDirectory('projects')
    expect(await written!.openDirectory(CREATED_ID)).not.toBeNull()
    const untouched = await original.openDirectory('projects')
    expect(await untouched!.openDirectory(CREATED_ID, { create: false })).toBeNull()
    expect(managerSource).toContain('handle = stored')
    expect(managerSource).toContain('store.write(stored)')
    expect(projectsSource).toContain('getConnectedProjectIds')
    expect(projectsSource).toContain('localProjectIds.includes(project.id)')
  })
})
