/* The session hook shares this provider file so panels can read one loading state. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'
import type { EditorSessionView } from '@/features/editor/editor-session'

const readySession: EditorSessionView = {
  phase: 'ready',
  statusLabel: null,
  structureReady: true,
  interactive: true,
}

const EditorSessionContext = createContext<EditorSessionView>(readySession)

export function EditorSessionProvider({
  value,
  children,
}: {
  value: EditorSessionView
  children: ReactNode
}) {
  return <EditorSessionContext.Provider value={value}>{children}</EditorSessionContext.Provider>
}

export function useEditorSession(): EditorSessionView {
  return useContext(EditorSessionContext)
}
