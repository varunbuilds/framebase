import { AvatarStack } from '@liveblocks/react-ui'
import { useCollabSession } from './collab-session-context'

/** People currently in this project room. Hidden when the editor has no room. */
export function CollaboratorAvatars() {
  const inRoom = useCollabSession()?.inRoom === true
  if (!inRoom) return null
  return (
    <AvatarStack
      size={22}
      max={3}
      variant="outline"
      aria-label="People in this project"
      className="shrink-0"
    />
  )
}
