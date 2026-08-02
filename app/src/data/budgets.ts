import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages, normaliseRows } from './rows'
import { toDb, type Numeric } from '../lib/money'
import type { ISODate } from '../lib/dates'
import type { Budget } from '../types'

export function useBudgets() {
  return useQuery({
    queryKey: queryKeys.budgets,
    queryFn: async (): Promise<Budget[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<Budget>((from, to) =>
        supabase.from('budgets').select('*').order('period_month').range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], ['amount']) as unknown as Budget[]
    },
  })
}

export function useSaveBudget() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({
      categoryId,
      periodMonth,
      amount,
      currency,
    }: {
      categoryId: string
      periodMonth: ISODate
      amount: Numeric
      currency: string
    }) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('budgets').upsert(
        {
          user_id: userId,
          category_id: categoryId,
          period_month: periodMonth,
          amount: toDb(amount),
          currency,
        },
        { onConflict: 'user_id,category_id,period_month' },
      )
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets }),
  })
}

export function useDeleteBudget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ categoryId, periodMonth }: { categoryId: string; periodMonth: ISODate }) => {
      const supabase = requireSupabase()
      const { error } = await supabase
        .from('budgets')
        .delete()
        .eq('category_id', categoryId)
        .eq('period_month', periodMonth)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets }),
  })
}

/** Copy a month's budgets forward, so setting them up is a once-off. */
export function useCopyBudgets() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ fromMonth, toMonth }: { fromMonth: ISODate; toMonth: ISODate }): Promise<number> => {
      const supabase = requireSupabase()

      const source = await fetchAllPages<Budget>((from, to) =>
        supabase.from('budgets').select('*').eq('period_month', fromMonth).range(from, to),
      )
      if (source.length === 0) return 0

      const rows = source.map((budget) => ({
        user_id: userId,
        category_id: budget.category_id,
        period_month: toMonth,
        amount: toDb(budget.amount),
        currency: budget.currency,
      }))

      const { error } = await supabase
        .from('budgets')
        .upsert(rows, { onConflict: 'user_id,category_id,period_month' })
      if (error) throw error
      return rows.length
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets }),
  })
}
