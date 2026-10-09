import { blobsMatch } from './media-record'
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

/** Copies files into `to`. Does not delete `from`. Throws before a size mismatch is accepted. */
export async function copyDirectoryContents(
  from: WorkspaceDirectory,
  to: WorkspaceDirectory,
): Promise<void> {
  for (const entry of await from.list()) {
    if (entry.kind === 'file') {
      const blob = await from.readFile(entry.name)
      if (!blob) throw new Error(`Missing ${entry.name} while copying the workspace.`)
      await to.writeFile(entry.name, blob)
      const written = await to.readFile(entry.name)
      if (!written || !(await blobsMatch(written, blob))) {
        throw new Error(`Incomplete copy of ${entry.name}. The original was left in place.`)
      }
      continue
    }
    const childFrom = await from.openDirectory(entry.name, { create: false })
    const childTo = await to.openDirectory(entry.name, { create: true })
    if (!childFrom || !childTo) {
      throw new Error(`Could not copy ${entry.name}. The original was left in place.`)
    }
    await copyDirectoryContents(childFrom, childTo)
  }
}
