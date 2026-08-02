import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { authRedirectUrl, isSupabaseConfigured, supabase } from '../lib/supabase'
import { clearApiCache } from '../pwa'

export type AuthStatus = 'loading' | 'signed_in' | 'signed_out' | 'unconfigured'

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  /** Sends a magic link. Resolves once the email is away, not once it is clicked. */
  sendMagicLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? 'loading' : 'unconfigured')

  useEffect(() => {
    if (!supabase) return
    let cancelled = false

    // getSession() also completes the PKCE exchange when the page was opened
    // from a magic link carrying ?code=.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        setSession(data.session)
        setStatus(data.session ? 'signed_in' : 'signed_out')
      })
      .catch(() => {
        if (cancelled) return
        // A network failure here means the backend is unreachable, not that
        // the user is signed out — but there is nothing to show them either
        // way except the sign-in screen, which surfaces the error.
        setStatus('signed_out')
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setStatus(nextSession ? 'signed_in' : 'signed_out')
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  const sendMagicLink = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured for this deployment.')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: authRedirectUrl() },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    // The service worker caches API reads for offline use; that cache holds
    // financial data and must not outlive the session on a shared device.
    clearApiCache()
    setSession(null)
    setStatus('signed_out')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, user: session?.user ?? null, sendMagicLink, signOut }),
    [status, session, sendMagicLink, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}

/** The signed-in user's id. Throws if called outside a protected route. */
export function useUserId(): string {
  const { user } = useAuth()
  if (!user) throw new Error('useUserId called while signed out')
  return user.id
}
