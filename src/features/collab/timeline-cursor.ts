/**
 * Shared timeline cursor space.
 * X is absolute timeline time. Y is content-space pixels from the top of the
 * timeline grid (ruler, then tracks). Neither value is a fraction of the
 * sender's visible viewport.
 */

export const TIMELINE_TRACK_HEIGHT = 104
export const TIMELINE_RULER_HEIGHT = 36
export const TIMELINE_LABEL_WIDTH = 88
export const TIMELINE_X_INSET = 2

export type TimelineCursorPoint = {
  timeMs: number
  contentY: number
  trackId: string | null
}

export type TimelineCursorLayout = {
  labelWidth: number
  xInset: number
  rulerHeight: number
  trackHeight: number
}

export const TIMELINE_CURSOR_LAYOUT: TimelineCursorLayout = {
  labelWidth: TIMELINE_LABEL_WIDTH,
  xInset: TIMELINE_X_INSET,
  rulerHeight: TIMELINE_RULER_HEIGHT,
  trackHeight: TIMELINE_TRACK_HEIGHT,
}

export type TimelineCursorViewport = {
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
  pixelsPerSecond: number
  layout: TimelineCursorLayout
}

export function pointerToTimelineCursor(args: {
  clientX: number
  clientY: number
  originX: number
  originY: number
  scrollLeft: number
  scrollTop: number
  pixelsPerSecond: number
  tracks: readonly string[]
  layout: TimelineCursorLayout
}): TimelineCursorPoint | null {
  if (args.pixelsPerSecond <= 0) return null
  const viewportX = args.clientX - args.originX
  const viewportY = args.clientY - args.originY
  if (viewportX < args.layout.labelWidth || viewportY < 0) return null

  const contentX =
    viewportX + args.scrollLeft - args.layout.labelWidth - args.layout.xInset
  if (contentX < 0) return null

  const onRuler = viewportY < args.layout.rulerHeight
  const contentY = onRuler ? viewportY : viewportY + args.scrollTop
  return {
    timeMs: (contentX / args.pixelsPerSecond) * 1000,
    contentY,
    trackId: onRuler ? null : trackIdAtContentY(contentY, args.tracks, args.layout),
  }
}

export function timelineCursorToViewport(
  cursor: TimelineCursorPoint,
  view: TimelineCursorViewport,
  tracks: readonly string[],
): { x: number; y: number } | null {
  if (view.pixelsPerSecond <= 0 || view.viewportWidth <= 0 || view.viewportHeight <= 0) {
    return null
  }
  const contentY = contentYForRecipient(cursor, tracks, view.layout)
  const contentX = (cursor.timeMs / 1000) * view.pixelsPerSecond
  const x = view.layout.labelWidth + view.layout.xInset + contentX - view.scrollLeft
  const y =
    contentY < view.layout.rulerHeight ? contentY : contentY - view.scrollTop

  if (x < view.layout.labelWidth || x > view.viewportWidth) return null
  if (y < 0 || y > view.viewportHeight) return null
  if (contentY >= view.layout.rulerHeight && y < view.layout.rulerHeight) return null
  return { x, y }
}

function trackIdAtContentY(
  contentY: number,
  tracks: readonly string[],
  layout: TimelineCursorLayout,
): string | null {
  if (tracks.length === 0 || contentY < layout.rulerHeight) return null
  const index = Math.floor((contentY - layout.rulerHeight) / layout.trackHeight)
  if (index < 0 || index >= tracks.length) return null
  return tracks[index] ?? null
}

function contentYForRecipient(
  cursor: TimelineCursorPoint,
  tracks: readonly string[],
  layout: TimelineCursorLayout,
): number {
  if (!cursor.trackId) return cursor.contentY
  const index = tracks.indexOf(cursor.trackId)
  if (index < 0) return cursor.contentY
  const offset = cursor.contentY - layout.rulerHeight
  const withinTrack = offset - Math.floor(offset / layout.trackHeight) * layout.trackHeight
  const clamped = Math.min(layout.trackHeight, Math.max(0, withinTrack))
  return layout.rulerHeight + index * layout.trackHeight + clamped
}
