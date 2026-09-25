import type { Session, User } from '@supabase/supabase-js'
import { createContext } from 'react'

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'unconfigured'

export type AuthContextValue = {
  status: AuthStatus
  session: Session | null
  user: User | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
