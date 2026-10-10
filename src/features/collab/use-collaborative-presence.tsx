import { Cursor } from '@liveblocks/react-ui'
import { useClient, useOthersMapped, useSelf, useUpdateMyPresence } from '@liveblocks/react'
import {
  cloneElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { getSortedTracks } from '@/features/editor/project'
import { useEditorStore } from '@/stores/editor-store'
import { useCollabSession } from './collab-session-context'
import {
  colorForUserId,
  type EditorActiveArea,
  type EditorCursor,
} from './presence-schema'
import { rememberCollaborators } from './collaborator-directory'
import {
  TIMELINE_CURSOR_LAYOUT,
  pointerToTimelineCursor,
  timelineCursorToViewport,
  type TimelineCursorPoint,
} from './timeline-cursor'

/**
 * Publishes the local selection and caches Supabase display names for
 * Liveblocks' Avatar and Cursor resolvers. Timeline cursors are an absolute
 * time plus content-space Y, published from the timeline surface.
 */
export function EditorPresenceBridge() {
  const client = useClient()
  const updateMyPresence = useUpdateMyPresence()
  const selectedClipId = useEditorStore(
    (state) => state.ui.selectedClipIds.at(-1) ?? null,
  )
  const selfId = useSelf((user) => user.id)
  const selfName = useSelf((user) => user.info.name)
  const roster = useOthersMapped(
    (user) => ({ id: user.id, name: user.info.name }),
    (previous, next) => previous.id === next.id && previous.name === next.name,
  )

  useEffect(() => {
    const entries: Array<{ id: string; name: string }> = []
    if (selfId && selfName) entries.push({ id: selfId, name: selfName })
    for (const [, user] of roster) {
      if (user.id && user.name) entries.push({ id: user.id, name: user.name })
    }
    if (rememberCollaborators(entries)) {
      client.resolvers.invalidateUsers(entries.map((entry) => entry.id))
    }
  }, [client, roster, selfId, selfName])

  useEffect(() => {
    updateMyPresence({ selectedClipId })
  }, [selectedClipId, updateMyPresence])

  return null
}

type PointerHandlers = {
  onPointerEnter?: (event: ReactPointerEvent) => void
  onPointerLeave?: (event: ReactPointerEvent) => void
}

function ActiveAreaBound({
  area,
  children,
}: {
  area: EditorActiveArea
  children: ReactElement<PointerHandlers>
}) {
  const updateMyPresence = useUpdateMyPresence()
  return cloneElement(children, {
    onPointerEnter: (event: ReactPointerEvent) => {
      updateMyPresence({ activeArea: area })
      children.props.onPointerEnter?.(event)
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      updateMyPresence({ activeArea: null })
      children.props.onPointerLeave?.(event)
    },
  })
}

/** Marks where the pointer is without adding a layout box. No-op outside a room. */
export function WithActiveArea({
  area,
  children,
}: {
  area: EditorActiveArea
  children: ReactElement<PointerHandlers>
}) {
  const inRoom = useCollabSession()?.inRoom === true
  if (!inRoom) return children
  return <ActiveAreaBound area={area}>{children}</ActiveAreaBound>
}

/**
 * Publishes an absolute timeline cursor and draws other people with the
 * Liveblocks cursor. The stock `Cursors` wrapper stores a fraction of the
 * sender's visible box, which drifts as soon as someone scrolls or zooms.
 */
export function TimelinePresence({ children }: { children: ReactNode }) {
  const updateMyPresence = useUpdateMyPresence()
  const rootRef = useRef<HTMLDivElement>(null)
  const pixelsPerSecond = useEditorStore((state) => state.ui.pixelsPerSecond)
  const document = useEditorStore((state) => state.document)
  const tracks = useMemo(() => getSortedTracks(document).map((track) => track.id), [document])
  const [scroll, setScroll] = useState({ left: 0, top: 0, width: 0, height: 0 })

  const rememberScroll = (element: HTMLElement) => {
    setScroll((current) => {
      const next = {
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.clientWidth,
        height: element.clientHeight,
      }
      if (
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
      ) {
        return current
      }
      return next
    })
  }

  useEffect(() => {
    const scrollEl = rootRef.current?.firstElementChild
    if (!(scrollEl instanceof HTMLElement)) return
    rememberScroll(scrollEl)
    const observer = new ResizeObserver(() => rememberScroll(scrollEl))
    observer.observe(scrollEl)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const clear = () => updateMyPresence({ cursor: null })
    window.addEventListener('blur', clear)
    return () => window.removeEventListener('blur', clear)
  }, [updateMyPresence])

  const publishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current
    const scrollEl = root?.firstElementChild
    if (!root || !(scrollEl instanceof HTMLElement)) return
    const bounds = root.getBoundingClientRect()
    const cursor = pointerToTimelineCursor({
      clientX: event.clientX,
      clientY: event.clientY,
      originX: bounds.left,
      originY: bounds.top,
      scrollLeft: scrollEl.scrollLeft,
      scrollTop: scrollEl.scrollTop,
      pixelsPerSecond,
      tracks,
      layout: TIMELINE_CURSOR_LAYOUT,
    })
    updateMyPresence({ cursor, activeArea: 'timeline' })
  }

  return (
    <div
      ref={rootRef}
      className="timeline-presence relative min-h-0 min-w-0 flex-1"
      onPointerEnter={() => updateMyPresence({ activeArea: 'timeline' })}
      onPointerMove={publishPointer}
      onPointerLeave={() => updateMyPresence({ cursor: null, activeArea: null })}
      onScrollCapture={(event) => {
        if (event.target instanceof HTMLElement) rememberScroll(event.target)
      }}
    >
      {children}
      <div className="pointer-events-none absolute inset-0 z-[60]">
        <TimelineRemoteCursors
          scroll={scroll}
          pixelsPerSecond={pixelsPerSecond}
          tracks={tracks}
        />
      </div>
    </div>
  )
}

function readTimelineCursor(value: unknown): TimelineCursorPoint | null {
  if (typeof value !== 'object' || value === null) return null
  const cursor = value as Partial<EditorCursor>
  if (typeof cursor.timeMs !== 'number' || typeof cursor.contentY !== 'number') return null
  return {
    timeMs: cursor.timeMs,
    contentY: cursor.contentY,
    trackId: typeof cursor.trackId === 'string' ? cursor.trackId : null,
  }
}

function TimelineRemoteCursors({
  scroll,
  pixelsPerSecond,
  tracks,
}: {
  scroll: { left: number; top: number; width: number; height: number }
  pixelsPerSecond: number
  tracks: readonly string[]
}) {
  const others = useOthersMapped(
    (user) => {
      const cursor = readTimelineCursor(user.presence.cursor)
      if (!cursor) return null
      const userId = user.id || String(user.connectionId)
      return {
        cursor,
        name: user.info.name?.trim() || 'Collaborator',
        color: colorForUserId(userId),
      }
    },
    (previous, next) =>
      previous?.cursor?.timeMs === next?.cursor?.timeMs &&
      previous?.cursor?.contentY === next?.cursor?.contentY &&
      previous?.cursor?.trackId === next?.cursor?.trackId &&
      previous?.name === next?.name &&
      previous?.color === next?.color,
  )

  return others.map(([connectionId, person]) => {
    if (!person) return null
    const point = timelineCursorToViewport(
      person.cursor,
      {
        scrollLeft: scroll.left,
        scrollTop: scroll.top,
        viewportWidth: scroll.width,
        viewportHeight: scroll.height,
        pixelsPerSecond,
        layout: TIMELINE_CURSOR_LAYOUT,
      },
      tracks,
    )
    if (!point) return null
    return (
      <div
        key={connectionId}
        className="absolute"
        style={{ left: point.x, top: point.y }}
      >
        <Cursor color={person.color} label={person.name} />
      </div>
    )
  })
}

/** Name chips for other people who have this clip selected. Not local selection. */
export function CollaboratorClipMarks({ clipId }: { clipId: string }) {
  const marks = useOthersMapped(
    (user) => {
      if (user.presence.selectedClipId !== clipId) return null
      const userId = user.id || String(user.connectionId)
      return {
        name: user.info.name?.trim() || 'Collaborator',
        color: colorForUserId(userId),
      }
    },
    (previous, next) =>
      previous?.name === next?.name && previous?.color === next?.color,
  )
  const visible = marks.filter(
    (entry): entry is readonly [number, { name: string; color: string }] =>
      entry[1] != null,
  )
  if (visible.length === 0) return null

  const outline = visible[0]?.[1].color
  return (
    <div className="pointer-events-none absolute inset-0 z-2 rounded-sm" aria-hidden>
      <div
        className="absolute inset-0 rounded-sm"
        style={{ boxShadow: outline ? `inset 0 0 0 1px ${outline}` : undefined }}
      />
      <div className="absolute top-full left-0 mt-1 flex max-w-45 flex-wrap gap-1">
        {visible.map(([connectionId, mark]) => (
          <span
            key={connectionId}
            className="max-w-full truncate rounded-full px-1.5 py-px text-[10px] leading-4 text-white"
            style={{ background: mark.color }}
          >
            {mark.name}
          </span>
        ))}
      </div>
    </div>
  )
}
