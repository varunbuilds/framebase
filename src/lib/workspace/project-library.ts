import type { WorkspaceSnapshot } from '@/lib/workspace/workspace-types'

/** The project library is visible only after this device's workspace is usable. */
export function showsProjectLibrary(status: WorkspaceSnapshot['status']): boolean {
  return status === 'ready'
}

/**
 * Reconnect updates workspace state in place. It does not change routes.
 * The library appears when the snapshot becomes ready.
 */
export async function reconnectWorkspaceForLibrary(
  reconnect: () => Promise<boolean>,
): Promise<'projects' | 'gate'> {
  const connected = await reconnect()
  return connected ? 'projects' : 'gate'
}
