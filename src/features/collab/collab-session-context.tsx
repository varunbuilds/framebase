/* The session hook ships with its provider so the editor chrome reads one value. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'
import type { CollabSessionView } from './collab-session'

/**
 * null outside a project room, so pages that never join one render no
 * collaborative chrome instead of pretending to be connected.
 */
const CollabSessionContext = createContext<CollabSessionView | null>(null)

export function CollabSessionProvider({
  value,
  children,
}: {
  value: CollabSessionView
  children: ReactNode
}) {
  return (
    <CollabSessionContext.Provider value={value}>{children}</CollabSessionContext.Provider>
  )
}

export function useCollabSession(): CollabSessionView | null {
  return useContext(CollabSessionContext)
}
