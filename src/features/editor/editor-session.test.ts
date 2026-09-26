import { describe, expect, it } from 'vitest'
import editorPageSource from '../../pages/EditorPage.tsx?raw'
import {
  autosaveEnabled,
  editorShellMounts,
  interactionsEnabled,
  playbackEnabled,
  previewFrameReady,
  structureReadyFor,
  type EditorSessionPhase,
} from './editor-session'

const phases: EditorSessionPhase[] = [
  'restoring-workspace',
  'needs-workspace',
  'opening',
  'syncing',
  'hydrating',
  'ready',
]

describe('editor loading session', () => {
  it('keeps the editor shell mounted through restore, sync, and reconnect', () => {
    for (const phase of phases) {
      expect(editorShellMounts(phase)).toBe(true)
    }
    expect(editorPageSource).toContain('<EditorShell />')
    expect(editorPageSource).not.toContain('OpeningProject')
    expect(editorPageSource).toContain('autosaveEnabled')
  })

  it('shows project structure while media is still syncing', () => {
    expect(structureReadyFor('opening')).toBe(false)
    expect(structureReadyFor('syncing')).toBe(true)
    expect(structureReadyFor('hydrating')).toBe(true)
    expect(structureReadyFor('ready')).toBe(true)
    expect(interactionsEnabled('syncing')).toBe(false)
    expect(interactionsEnabled('hydrating')).toBe(false)
    expect(autosaveEnabled('hydrating')).toBe(false)
  })

  it('enables editing, playback, and autosave only after hydration', () => {
    expect(interactionsEnabled('ready')).toBe(true)
    expect(autosaveEnabled('ready')).toBe(true)
    expect(
      playbackEnabled({
        interactive: true,
        activeClipNeedsSource: true,
        sourceReady: true,
      }),
    ).toBe(true)
    expect(
      playbackEnabled({
        interactive: true,
        activeClipNeedsSource: true,
        sourceReady: false,
      }),
    ).toBe(false)
    expect(
      playbackEnabled({
        interactive: false,
        activeClipNeedsSource: false,
        sourceReady: false,
      }),
    ).toBe(false)
  })

  it('keeps a preview skeleton until the active source is ready', () => {
    expect(
      previewFrameReady({
        structureReady: false,
        interactive: false,
        activeClipNeedsSource: true,
        sourceReady: false,
      }),
    ).toBe(false)
    expect(
      previewFrameReady({
        structureReady: true,
        interactive: false,
        activeClipNeedsSource: true,
        sourceReady: false,
      }),
    ).toBe(false)
    expect(
      previewFrameReady({
        structureReady: true,
        interactive: false,
        activeClipNeedsSource: true,
        sourceReady: true,
      }),
    ).toBe(true)
    expect(
      previewFrameReady({
        structureReady: true,
        interactive: false,
        activeClipNeedsSource: false,
        sourceReady: false,
      }),
    ).toBe(true)
    expect(
      previewFrameReady({
        structureReady: true,
        interactive: true,
        activeClipNeedsSource: true,
        sourceReady: false,
      }),
    ).toBe(true)
  })

  it('does not treat a workspace gate or a failed file as a reason to hide the shell', () => {
    expect(structureReadyFor('needs-workspace')).toBe(false)
    expect(interactionsEnabled('needs-workspace')).toBe(false)
    expect(autosaveEnabled('needs-workspace')).toBe(false)
    expect(editorShellMounts('needs-workspace')).toBe(true)
  })
})
