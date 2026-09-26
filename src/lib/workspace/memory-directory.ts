import type { WorkspaceDirectory, WorkspaceEntry } from './workspace-types'

type FileNode = { kind: 'file'; bytes: Uint8Array; type: string }
type DirNode = { kind: 'directory'; children: Map<string, FileNode | DirNode> }

export function createMemoryDirectory(name = 'Framebase'): WorkspaceDirectory {
  const root: DirNode = { kind: 'directory', children: new Map() }
  return directoryView(name, root)
}

function directoryView(name: string, node: DirNode): WorkspaceDirectory {
  return {
    name,
    async list() {
      const entries: WorkspaceEntry[] = []
      for (const [entryName, child] of node.children) {
        entries.push({
          name: entryName,
          kind: child.kind === 'file' ? 'file' : 'directory',
        })
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name))
    },
    async readFile(fileName) {
      assertEntryName(fileName)
      const child = node.children.get(fileName)
      if (!child) return null
      if (child.kind !== 'file') throw new Error(`${fileName} is a folder`)
      const copy = new ArrayBuffer(child.bytes.byteLength)
      new Uint8Array(copy).set(child.bytes)
      return new Blob([copy], { type: child.type || 'application/octet-stream' })
    },
    async writeFile(fileName, data) {
      assertEntryName(fileName)
      const existing = node.children.get(fileName)
      if (existing?.kind === 'directory') throw new Error(`${fileName} is a folder`)
      const bytes = new Uint8Array(await data.arrayBuffer())
      const copy = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(copy).set(bytes)
      node.children.set(fileName, {
        kind: 'file',
        bytes: new Uint8Array(copy),
        type: data.type || 'application/octet-stream',
      })
    },
    async remove(entryName, options) {
      assertEntryName(entryName)
      const child = node.children.get(entryName)
      if (!child) return
      if (child.kind === 'directory' && child.children.size > 0 && !options?.recursive) {
        throw new Error(`${entryName} is not empty`)
      }
      node.children.delete(entryName)
    },
    async openDirectory(entryName, options) {
      assertEntryName(entryName)
      const child = node.children.get(entryName)
      if (!child) {
        if (!options?.create) return null
        const created: DirNode = { kind: 'directory', children: new Map() }
        node.children.set(entryName, created)
        return directoryView(entryName, created)
      }
      if (child.kind !== 'directory') throw new Error(`${entryName} is a file`)
      return directoryView(entryName, child)
    },
  }
}

function assertEntryName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid workspace entry name')
  }
}
