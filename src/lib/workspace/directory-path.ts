import type { WorkspaceDirectory } from './workspace-types'

export async function openDirectoryPath(
  root: WorkspaceDirectory,
  segments: string[],
  create: boolean,
): Promise<WorkspaceDirectory | null> {
  let current = root
  for (const segment of segments) {
    const next = await current.openDirectory(segment, { create })
    if (!next) return null
    current = next
  }
  return current
}

export async function readJson(directory: WorkspaceDirectory, name: string): Promise<unknown> {
  const file = await directory.readFile(name)
  if (!file) return null
  return JSON.parse(await file.text()) as unknown
}

export async function writeJson(
  directory: WorkspaceDirectory,
  name: string,
  value: unknown,
): Promise<void> {
  await directory.writeFile(
    name,
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
}
