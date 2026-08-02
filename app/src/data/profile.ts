import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { queryKeys } from './keys'
import type { Profile } from '../types'

/**
 * The profile row is created by a trigger on auth.users. It is fetched with
 * maybeSingle() and self-heals if the trigger has not been installed, so a
 * missing row degrades to "defaults" rather than a blank app.
 */
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: async (): Promise<Profile | null> => {
      const supabase = requireSupabase()
      const { data: auth } = await supabase.auth.getUser()
      const userId = auth.user?.id
      if (!userId) return null

      const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle()
      if (error) throw error
      if (data) return data as Profile

      const { data: created, error: insertError } = await supabase
        .from('profiles')
        .insert({ user_id: userId, base_currency: 'AUD' })
        .select()
        .single()
      if (insertError) throw insertError
      return created as Profile
    },
    staleTime: 5 * 60_000,
  })
}

/** Base currency, defaulting to AUD until the profile loads. */
export function useBaseCurrency(): string {
  const { data } = useProfile()
  return data?.base_currency ?? 'AUD'
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Profile, 'display_name' | 'base_currency' | 'secondary_currency'>>) => {
      const supabase = requireSupabase()
      const { data: auth } = await supabase.auth.getUser()
      const userId = auth.user?.id
      if (!userId) throw new Error('Not signed in')

      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('user_id', userId)
        .select()
        .single()
      if (error) throw error
      return data as Profile
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.profile, profile)
      // Base currency changes every derived figure in the app.
      queryClient.invalidateQueries()
    },
  })
}
