import { Cursors } from '@liveblocks/react-ui'
import { useClient, useOthersMapped, useSelf, useUpdateMyPresence } from '@liveblocks/react'
import {
  cloneElement,
  useEffect,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useEditorStore } from '@/stores/editor-store'
import { useCollabSession } from './collab-session-context'
import {
  colorForUserId,
  type EditorActiveArea,
} from './presence-schema'
import { rememberCollaborators } from './collaborator-directory'

/**
 * Publishes the local selection and caches Supabase display names for
 * Liveblocks' Avatar and Cursor resolvers. Cursor coordinates are published
 * by the Liveblocks `Cursors` component, not here.
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
  onPointerEnter?: (event: PointerEvent) => void
  onPointerLeave?: (event: PointerEvent) => void
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
    onPointerEnter: (event: PointerEvent) => {
      updateMyPresence({ activeArea: area })
      children.props.onPointerEnter?.(event)
    },
    onPointerLeave: (event: PointerEvent) => {
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
 * Liveblocks `Cursors` tracks container-relative pointer position and draws
 * other users' named cursors. The scroll surface is a child so the cursor
 * overlay stays on the visible timeline. The fill size is in index.css,
 * because Liveblocks' unlayered cursor rule would otherwise clip this panel.
 */
export function TimelinePresence({ children }: { children: ReactNode }) {
  const updateMyPresence = useUpdateMyPresence()
  return (
    <div
      className="timeline-presence relative min-h-0 min-w-0 flex-1"
      onPointerEnter={() => updateMyPresence({ activeArea: 'timeline' })}
      onPointerLeave={() => updateMyPresence({ activeArea: null })}
    >
      <Cursors>{children}</Cursors>
    </div>
  )
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
