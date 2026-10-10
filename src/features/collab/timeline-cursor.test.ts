import { describe, expect, it } from 'vitest'
import {
  TIMELINE_CURSOR_LAYOUT,
  pointerToTimelineCursor,
  timelineCursorToViewport,
  type TimelineCursorViewport,
} from './timeline-cursor'

const layout = TIMELINE_CURSOR_LAYOUT
const tracks = ['video', 'audio']

function view(overrides: Partial<TimelineCursorViewport> = {}): TimelineCursorViewport {
  return {
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 800,
    viewportHeight: 400,
    pixelsPerSecond: 100,
    layout,
    ...overrides,
  }
}

function pointer(args: {
  clientX: number
  clientY: number
  scrollLeft?: number
  scrollTop?: number
  pixelsPerSecond?: number
}) {
  return pointerToTimelineCursor({
    clientX: args.clientX,
    clientY: args.clientY,
    originX: 0,
    originY: 0,
    scrollLeft: args.scrollLeft ?? 0,
    scrollTop: args.scrollTop ?? 0,
    pixelsPerSecond: args.pixelsPerSecond ?? 100,
    tracks,
    layout,
  })
}

describe('timeline cursor coordinates', () => {
  it('maps a pointer to the same viewport position when scroll and zoom match', () => {
    const cursor = pointer({ clientX: 188, clientY: 80 })
    expect(cursor).toEqual({ timeMs: 980, contentY: 80, trackId: 'video' })
    expect(timelineCursorToViewport(cursor!, view(), tracks)).toEqual({ x: 188, y: 80 })
  })

  it('keeps the same timeline time when the sender has scrolled horizontally', () => {
    const scrolled = pointer({ clientX: 188, clientY: 80, scrollLeft: 1000 })
    const origin = pointer({ clientX: 1188, clientY: 80, scrollLeft: 0 })
    expect(scrolled?.timeMs).toBe(origin?.timeMs)
    expect(scrolled?.timeMs).toBe(10980)

    const recipient = timelineCursorToViewport(
      scrolled!,
      view({ scrollLeft: 0, viewportWidth: 1400 }),
      tracks,
    )
    expect(recipient).toEqual({ x: 1188, y: 80 })
    expect(
      timelineCursorToViewport(scrolled!, view({ scrollLeft: 1000 }), tracks),
    ).toEqual({ x: 188, y: 80 })
  })

  it('aligns the same time when zoom differs', () => {
    const cursor = pointer({ clientX: 188, clientY: 80, pixelsPerSecond: 100 })
    expect(cursor?.timeMs).toBe(980)
    expect(
      timelineCursorToViewport(cursor!, view({ pixelsPerSecond: 200 }), tracks),
    ).toEqual({ x: 286, y: 80 })
    expect(
      timelineCursorToViewport(cursor!, view({ pixelsPerSecond: 50 }), tracks),
    ).toEqual({ x: 139, y: 80 })
  })

  it('keeps pointers at the start and end of the visible time range', () => {
    const start = pointer({ clientX: layout.labelWidth, clientY: 20, scrollLeft: 400 })
    expect(start?.timeMs).toBeCloseTo(((400 - layout.xInset) / 100) * 1000)
    expect(timelineCursorToViewport(start!, view({ scrollLeft: 400 }), tracks)?.x).toBe(
      layout.labelWidth,
    )

    const end = pointer({ clientX: 800, clientY: 20, scrollLeft: 0 })
    expect(timelineCursorToViewport(end!, view(), tracks)?.x).toBe(800)
  })

  it('hides a cursor that is outside the recipient viewport', () => {
    const cursor = pointer({ clientX: 188, clientY: 80, scrollLeft: 5000 })
    expect(timelineCursorToViewport(cursor!, view({ scrollLeft: 0 }), tracks)).toBeNull()
    expect(
      timelineCursorToViewport(cursor!, view({ scrollLeft: 5000, viewportWidth: 120 }), tracks),
    ).toBeNull()
  })

  it('follows vertical scroll and hides a track that is scrolled out of view', () => {
    const onSecondTrack = pointer({ clientX: 188, clientY: 56, scrollTop: 104 })
    expect(onSecondTrack).toMatchObject({ contentY: 160, trackId: 'audio' })

    expect(timelineCursorToViewport(onSecondTrack!, view({ scrollTop: 0 }), tracks)?.y).toBe(160)
    expect(timelineCursorToViewport(onSecondTrack!, view({ scrollTop: 104 }), tracks)?.y).toBe(56)

    const below = pointer({ clientX: 188, clientY: 300, scrollTop: 0 })
    expect(
      timelineCursorToViewport(below!, view({ scrollTop: 400, viewportHeight: 200 }), tracks),
    ).toBeNull()
  })

  it('does not treat the track-label column as timeline time', () => {
    expect(pointer({ clientX: layout.labelWidth - 1, clientY: 80 })).toBeNull()
  })
})
