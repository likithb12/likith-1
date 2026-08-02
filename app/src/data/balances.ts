import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages, normaliseRows } from './rows'
import { toDb, type Numeric } from '../lib/money'
import type { ISODate } from '../lib/dates'
import type { BalanceSnapshot, SnapshotSource } from '../types'

const NUMERIC_FIELDS = ['balance'] as const

export function useBalanceSnapshots() {
  return useQuery({
    queryKey: queryKeys.balanceSnapshots(),
    queryFn: async (): Promise<BalanceSnapshot[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<BalanceSnapshot>((from, to) =>
        supabase
          .from('balance_snapshots')
          .select('*')
          .order('as_at', { ascending: true })
          .range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], NUMERIC_FIELDS) as unknown as BalanceSnapshot[]
    },
  })
}

export interface SnapshotInput {
  account_id: string
  as_at: ISODate
  balance: Numeric
  currency: string
  source?: SnapshotSource
  note?: string | null
}

/**
 * Upsert one or more snapshots. Conflict target is (account_id, as_at), so
 * re-entering a balance for a date the user already recorded corrects it
 * rather than failing — which is what someone fixing a typo expects.
 */
export function useSaveSnapshots() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async (inputs: SnapshotInput[]): Promise<number> => {
      if (inputs.length === 0) return 0
      const supabase = requireSupabase()

      const rows = inputs.map((input) => ({
        user_id: userId,
        account_id: input.account_id,
        as_at: input.as_at,
        balance: toDb(input.balance),
        currency: input.currency,
        source: input.source ?? 'manual',
        note: input.note ?? null,
      }))

      const { error } = await supabase
        .from('balance_snapshots')
        .upsert(rows, { onConflict: 'account_id,as_at' })
      if (error) throw error
      return rows.length
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDeleteSnapshot() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('balance_snapshots').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
