import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client.
 *
 * The anon key is public by design and ships in this bundle. That is not a
 * leak: Row Level Security is the security boundary, and every table is
 * scoped to `user_id = auth.uid()`. The service_role key must never appear
 * here or anywhere else in the repository.
 */

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/** False when the deployment has no backend configured yet. */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabaseUrl = url

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // PKCE returns the code as a query parameter (?code=...). The implicit
        // flow returns it in the URL fragment, which would collide with
        // HashRouter — see DECISIONS.md.
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

/** Throwing accessor for code paths that cannot proceed without a backend. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new BackendNotConfiguredError()
  }
  return supabase
}

export class BackendNotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured for this deployment.')
    this.name = 'BackendNotConfiguredError'
  }
}

/**
 * The URL the magic link should return to. Must be listed in the Supabase
 * dashboard under Authentication → URL Configuration → Redirect URLs, or the
 * link silently bounces to the site URL instead.
 */
export function authRedirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

/**
 * A Supabase project on the free tier pauses after a period of inactivity,
 * and a paused project fails as an opaque network error. Distinguishing that
 * from a genuine bug is the difference between "the app is broken" and
 * "unpause the project".
 */
export function isBackendUnreachable(error: unknown): boolean {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  return (
    /failed to fetch/i.test(message) ||
    /networkerror/i.test(message) ||
    /load failed/i.test(message) ||
    /fetch failed/i.test(message) ||
    /ERR_NAME_NOT_RESOLVED/i.test(message) ||
    /service unavailable/i.test(message)
  )
}

/** Human-readable message for anything thrown by the data layer. */
export function describeError(error: unknown): string {
  if (!error) return 'Something went wrong.'
  if (error instanceof BackendNotConfiguredError) return error.message
  if (isBackendUnreachable(error)) {
    return 'Cannot reach the backend. If the Supabase project is on the free tier it may have been paused for inactivity — open the Supabase dashboard and resume it.'
  }
  const message = error instanceof Error ? error.message : String(error)
  return message || 'Something went wrong.'
}
