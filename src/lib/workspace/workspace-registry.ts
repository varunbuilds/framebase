import type { WorkspaceAvailability } from './workspace-handle-store'

export type KnownWorkspaceView = {
  workspaceId: string
  name: string
  lastUsedAt: string
  availability: WorkspaceAvailability
  active: boolean
}

/** Two folders can share a display name. The menu keeps both and numbers the copies. */
export function workspaceMenuLabel(
  entry: { workspaceId: string; name: string },
  all: readonly { workspaceId: string; name: string }[],
): string {
  const duplicates = all.filter((item) => item.name === entry.name)
  if (duplicates.length < 2) return entry.name
  const index = duplicates.findIndex((item) => item.workspaceId === entry.workspaceId)
  return `${entry.name} (${index + 1})`
}

/**
 * Registry entries are the recent list. When nothing has been registered yet,
 * the connected workspace is still shown so the menu is not empty.
 */
export function knownWorkspaceViews(
  entries: readonly {
    workspaceId: string
    name: string
    lastUsedAt: string
    availability: WorkspaceAvailability
  }[],
  active: { workspaceId: string; name: string } | null,
): KnownWorkspaceView[] {
  if (entries.length === 0 && active) {
    return [
      {
        workspaceId: active.workspaceId,
        name: active.name,
        lastUsedAt: '',
        availability: 'available',
        active: true,
      },
    ]
  }
  return [...entries]
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .map((entry) => ({
      workspaceId: entry.workspaceId,
      name: workspaceMenuLabel(entry, entries),
      lastUsedAt: entry.lastUsedAt,
      availability: entry.availability,
      active: active?.workspaceId === entry.workspaceId,
    }))
}
