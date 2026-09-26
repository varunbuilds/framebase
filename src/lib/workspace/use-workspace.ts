import { useSyncExternalStore } from 'react'
import { getWorkspaceSnapshot, subscribeWorkspace } from './workspace-manager'
import type { WorkspaceSnapshot } from './workspace-types'

export function useWorkspace(): WorkspaceSnapshot {
  return useSyncExternalStore(subscribeWorkspace, getWorkspaceSnapshot, getWorkspaceSnapshot)
}
