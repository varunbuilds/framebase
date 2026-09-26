import { useSyncExternalStore } from 'react'

/** Runtime upload and download state. Not written to ProjectDocument. */
export type CloudTransfer = {
  phase: 'uploading' | 'downloading' | 'error'
  progress: number | null
  message: string | null
}

const transfers = new Map<string, CloudTransfer>()
const listeners = new Set<() => void>()
let revision = 0

function emit(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function getCloudTransfer(mediaSourceId: string): CloudTransfer | null {
  return transfers.get(mediaSourceId) ?? null
}

export function setCloudTransfer(mediaSourceId: string, transfer: CloudTransfer): void {
  transfers.set(mediaSourceId, transfer)
  emit()
}

export function clearCloudTransfer(mediaSourceId: string): void {
  if (!transfers.delete(mediaSourceId)) return
  emit()
}

export function subscribeCloudTransfers(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCloudTransfer(mediaSourceId: string): CloudTransfer | null {
  return useSyncExternalStore(subscribeCloudTransfers, () => getCloudTransfer(mediaSourceId))
}

/** Lets the media panel reread object URLs after a download finishes. */
export function useCloudUiRevision(): number {
  return useSyncExternalStore(subscribeCloudTransfers, () => revision)
}
