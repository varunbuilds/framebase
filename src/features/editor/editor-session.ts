export type EditorSessionPhase =
  | 'restoring-workspace'
  | 'needs-workspace'
  | 'opening'
  | 'syncing'
  | 'hydrating'
  | 'ready'

export type EditorSessionView = {
  phase: EditorSessionPhase
  statusLabel: string | null
  /** Project JSON is in the editor, so names, tracks, and media rows can render. */
  structureReady: boolean
  /** Initial hydration finished. Editing and autosave are allowed. */
  interactive: boolean
}

/** The editor chrome is on screen for every open phase, including sync. */
export function editorShellMounts(phase: EditorSessionPhase): boolean {
  return (
    phase === 'restoring-workspace' ||
    phase === 'needs-workspace' ||
    phase === 'opening' ||
    phase === 'syncing' ||
    phase === 'hydrating' ||
    phase === 'ready'
  )
}

export function structureReadyFor(phase: EditorSessionPhase): boolean {
  return phase === 'syncing' || phase === 'hydrating' || phase === 'ready'
}

export function interactionsEnabled(phase: EditorSessionPhase): boolean {
  return phase === 'ready'
}

export function autosaveEnabled(phase: EditorSessionPhase): boolean {
  return phase === 'ready'
}

/** Playback waits until this device can play the clip that is under the playhead. */
export function playbackEnabled(args: {
  interactive: boolean
  activeClipNeedsSource: boolean
  sourceReady: boolean
}): boolean {
  if (!args.interactive) return false
  if (!args.activeClipNeedsSource) return true
  return args.sourceReady
}

/**
 * The preview frame can leave its skeleton once the project is loaded and
 * either nothing needs a file, or this device already has the active source.
 * A finished open with a failed download shows the real preview, not a skeleton.
 */
export function previewFrameReady(args: {
  structureReady: boolean
  interactive: boolean
  activeClipNeedsSource: boolean
  sourceReady: boolean
}): boolean {
  if (!args.structureReady) return false
  if (!args.activeClipNeedsSource) return true
  if (args.sourceReady) return true
  return args.interactive
}
