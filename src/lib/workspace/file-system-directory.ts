import type { WorkspaceDirectory, WorkspaceEntry } from './workspace-types'

/** Browser File System Access handle. Not stored in the project document. */
export function directoryFromHandle(
  handle: FileSystemDirectoryHandle,
): WorkspaceDirectory {
  return {
    name: handle.name,
    async list() {
      const entries: WorkspaceEntry[] = []
      for await (const [name, child] of handle.entries()) {
        entries.push({ name, kind: child.kind })
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name))
    },
    async readFile(name) {
      assertEntryName(name)
      try {
        const fileHandle = await handle.getFileHandle(name)
        return await fileHandle.getFile()
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async writeFile(name, data) {
      assertEntryName(name)
      const fileHandle = await handle.getFileHandle(name, { create: true })
      const writable = await fileHandle.createWritable()
      try {
        await writable.write(data)
        await writable.close()
      } catch (error) {
        try {
          await writable.abort()
        } catch {
          // The stream may already be closed.
        }
        try {
          await handle.removeEntry(name)
        } catch {
          // A failed write may not have created the file.
        }
        throw error
      }
    },
    async remove(name, options) {
      assertEntryName(name)
      try {
        await handle.removeEntry(name, { recursive: options?.recursive ?? false })
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    },
    async openDirectory(name, options) {
      assertEntryName(name)
      try {
        const child = await handle.getDirectoryHandle(name, {
          create: options?.create ?? false,
        })
        return directoryFromHandle(child)
      } catch (error) {
        if (!options?.create && isNotFound(error)) return null
        throw error
      }
    },
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

export function assertEntryName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid workspace entry name')
  }
}
