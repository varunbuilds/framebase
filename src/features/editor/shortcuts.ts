export type ShortcutEvent = {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/** Cmd+S / Ctrl+S. Matches the physical key so layout does not matter. */
export function isProjectSaveShortcut(event: ShortcutEvent): boolean {
  if (event.altKey) return false
  if (!(event.metaKey || event.ctrlKey)) return false
  return event.code === 'KeyS' || event.key.toLowerCase() === 's'
}

export function projectSaveShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+S'
  const platform = navigator.platform ?? ''
  const apple = /Mac|iPhone|iPad|iPod/.test(platform)
  return apple ? '⌘S' : 'Ctrl+S'
}
