import type { Status } from '@liveblocks/client'

type SyncStatus = 'synchronizing' | 'synchronized'

/**
 * Collaborative connection state, derived from Liveblocks and shaped for the
 * existing editor chrome. Pure so the editor can be reasoned about (and tested)
 * without a live room.
 */

export type CollabConnection =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

export type CollabFailure = 'unauthorized' | 'room-load'

export type CollabPhase =
  | 'connecting'
  | 'loading'
  | 'ready'
  | 'unauthorized'
  | 'failed'

export type CollabSessionView = {
  phase: CollabPhase
  connection: CollabConnection
  /** Local edits accepted by the editor but not yet acknowledged by the server. */
  pendingChanges: boolean
  errorMessage: string | null
  /** True only while this editor is inside the project Liveblocks room. */
  inRoom: boolean
}

export function collabConnection(status: Status): CollabConnection {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'reconnecting':
      return 'reconnecting'
    case 'disconnected':
      return 'disconnected'
    default:
      return 'connecting'
  }
}

export function collabPendingChanges(syncStatus: SyncStatus): boolean {
  return syncStatus !== 'synchronized'
}

/**
 * Room connection close codes. 4001 is an unauthorized token and -1 means the
 * auth endpoint itself failed, which for Framebase is a rejected membership
 * check often enough to report as an access problem.
 */
export function collabFailureForCode(code: number): CollabFailure {
  return code === 4001 || code === -1 ? 'unauthorized' : 'room-load'
}

export function collabPhase(args: {
  connection: CollabConnection
  documentReady: boolean
  failure: CollabFailure | null
}): CollabPhase {
  if (args.failure === 'unauthorized') return 'unauthorized'
  if (args.failure === 'room-load') return 'failed'
  if (args.documentReady) return 'ready'
  return args.connection === 'connected' ? 'loading' : 'connecting'
}

/** True once the collaborative document has been loaded into the editor. */
export function collabDocumentReady(view: CollabSessionView): boolean {
  return view.phase === 'ready'
}

export type CollabIndicatorTone = 'live' | 'pending' | 'warn' | 'error'

export type CollabIndicator = {
  /** Full sentence for the banner. */
  label: string
  /** Two or three words for the toolbar status. */
  short: string
  tone: CollabIndicatorTone
  /** Worth interrupting the editor with a banner, not just a status dot. */
  blocking: boolean
}

export function collabIndicator(view: CollabSessionView): CollabIndicator {
  if (view.phase === 'unauthorized') {
    return {
      label: view.errorMessage ?? 'You do not have access to this project.',
      short: 'No access',
      tone: 'error',
      blocking: true,
    }
  }
  if (view.phase === 'failed') {
    return {
      label: view.errorMessage ?? 'Collaboration is unavailable.',
      short: 'Sync failed',
      tone: 'error',
      blocking: true,
    }
  }
  if (view.phase === 'connecting') {
    return {
      label: 'Connecting to this project…',
      short: 'Connecting…',
      tone: 'pending',
      blocking: false,
    }
  }
  if (view.phase === 'loading') {
    return {
      label: 'Loading the collaborative project…',
      short: 'Loading…',
      tone: 'pending',
      blocking: false,
    }
  }
  if (view.connection === 'reconnecting') {
    return {
      label: 'Reconnecting. Your edits are kept and will sync when the room is back.',
      short: 'Reconnecting…',
      tone: 'warn',
      blocking: true,
    }
  }
  if (view.connection === 'disconnected') {
    return {
      label: view.pendingChanges
        ? 'Offline. Your edits are kept and will sync when you reconnect.'
        : 'Offline. Framebase reconnects when the network returns.',
      short: 'Offline',
      tone: 'warn',
      blocking: true,
    }
  }
  if (view.pendingChanges) {
    return { label: 'Syncing changes…', short: 'Syncing…', tone: 'pending', blocking: false }
  }
  return { label: 'Live', short: 'Live', tone: 'live', blocking: false }
}
