import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages } from './rows'
import { toDb } from '../lib/money'
import type { ISODate } from '../lib/dates'
import type { Account, AccountClass, AccountType } from '../types'

export interface AccountInput {
  name: string
  institution: string | null
  class: AccountClass
  type: AccountType
  currency: string
  is_active: boolean
  include_in_net_worth: boolean
  display_order?: number
}

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: async (): Promise<Account[]> => {
      const supabase = requireSupabase()
      return fetchAllPages<Account>((from, to) =>
        supabase
          .from('accounts')
          .select('*')
          .order('display_order', { ascending: true })
          .order('name', { ascending: true })
          .range(from, to),
      )
    },
  })
}

export function useCreateAccount() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async (input: AccountInput): Promise<Account> => {
      const supabase = requireSupabase()
      const { data, error } = await supabase
        .from('accounts')
        .insert({ ...input, user_id: userId })
        .select()
        .single()
      if (error) throw error
      return data as Account
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
  })
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AccountInput> }): Promise<Account> => {
      const supabase = requireSupabase()
      const { data, error } = await supabase.from('accounts').update(patch).eq('id', id).select().single()
      if (error) throw error
      return data as Account
    },
    onSuccess: () => {
      // An account's class or inclusion flag changes the totals.
      queryClient.invalidateQueries()
    },
  })
}

/**
 * Deleting an account cascades to its balance snapshots, so the whole history
 * for that account disappears from the trend. The UI warns about this and
 * offers deactivation as the non-destructive alternative.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('accounts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

/**
 * Close an account: deactivate it and record a final zero balance so it stops
 * contributing to net worth from that date forward, without erasing the
 * history that was genuinely real. See DECISIONS.md D13.
 */
export function useCloseAccount() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ account, asAt }: { account: Account; asAt: ISODate }) => {
      const supabase = requireSupabase()

      const { error: snapshotError } = await supabase.from('balance_snapshots').upsert(
        {
          user_id: userId,
          account_id: account.id,
          as_at: asAt,
          balance: toDb(0),
          currency: account.currency,
          source: 'manual',
          note: 'Account closed',
        },
        { onConflict: 'account_id,as_at' },
      )
      if (snapshotError) throw snapshotError

      const { error } = await supabase.from('accounts').update({ is_active: false }).eq('id', account.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
