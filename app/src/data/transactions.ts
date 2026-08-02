import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages, normaliseRows } from './rows'
import { dedupeBaseHash, countExistingByBaseHash, type DedupeParts } from '../lib/dedupe'
import { toDb, type Numeric } from '../lib/money'
import type { ISODate } from '../lib/dates'
import type { Transaction, TxnDirection } from '../types'

const NUMERIC_FIELDS = ['amount'] as const

export interface TransactionFilters {
  from?: ISODate | null
  to?: ISODate | null
  accountId?: string | null
  categoryId?: string | null
  uncategorisedOnly?: boolean
  includeTransfers?: boolean
  search?: string
}

export function useTransactions(filters: TransactionFilters = {}) {
  return useQuery({
    queryKey: queryKeys.transactions(filters),
    queryFn: async (): Promise<Transaction[]> => {
      const supabase = requireSupabase()

      const rows = await fetchAllPages<Transaction>((from, to) => {
        let query = supabase.from('transactions').select('*')

        if (filters.from) query = query.gte('txn_date', filters.from)
        if (filters.to) query = query.lte('txn_date', filters.to)
        if (filters.accountId) query = query.eq('account_id', filters.accountId)
        if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
        if (filters.uncategorisedOnly) query = query.is('category_id', null)
        if (filters.includeTransfers === false) query = query.eq('is_transfer', false)
        if (filters.search?.trim()) {
          const term = filters.search.trim().replace(/[%,]/g, ' ')
          query = query.or(`description.ilike.%${term}%,description_raw.ilike.%${term}%`)
        }

        return query.order('txn_date', { ascending: false }).order('id').range(from, to)
      })

      return normaliseRows(
        rows as unknown as Record<string, unknown>[],
        NUMERIC_FIELDS,
      ) as unknown as Transaction[]
    },
  })
}

/**
 * Next available dedupe hash for a single manual entry.
 *
 * The stored hash is the spec's SHA-256 plus an occurrence index, so two
 * genuinely identical transactions on the same day can both exist. See
 * DECISIONS.md D17.
 */
export async function nextDedupeHash(supabase: SupabaseClient, parts: DedupeParts): Promise<string> {
  const base = await dedupeBaseHash(parts)
  const { data, error } = await supabase
    .from('transactions')
    .select('dedupe_hash')
    .like('dedupe_hash', `${base}%`)
  if (error) throw error

  const counts = countExistingByBaseHash((data ?? []).map((row) => (row as { dedupe_hash: string }).dedupe_hash))
  return `${base}:${counts[base] ?? 0}`
}

export interface TransactionInput {
  account_id: string | null
  txn_date: ISODate
  amount: Numeric
  direction: TxnDirection
  currency: string
  description: string
  category_id: string | null
  is_transfer: boolean
}

export function useCreateTransaction() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async (input: TransactionInput): Promise<Transaction> => {
      const supabase = requireSupabase()
      const amount = toDb(input.amount)

      const dedupe_hash = await nextDedupeHash(supabase, {
        userId,
        accountId: input.account_id,
        txnDate: input.txn_date,
        amount,
        descriptionRaw: input.description,
      })

      const { data, error } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          account_id: input.account_id,
          txn_date: input.txn_date,
          amount,
          direction: input.direction,
          currency: input.currency,
          description: input.description,
          description_raw: input.description,
          category_id: input.category_id,
          is_transfer: input.is_transfer,
          source: 'manual',
          dedupe_hash,
        })
        .select()
        .single()
      if (error) throw error
      return data as Transaction
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
  })
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<Transaction, 'category_id' | 'description' | 'is_transfer' | 'account_id'>>
    }) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('transactions').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
  })
}

/** Categorise many rows at once, for the bulk action on the list. */
export function useBulkCategorise() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) => {
      if (ids.length === 0) return 0
      const supabase = requireSupabase()
      const { error } = await supabase.from('transactions').update({ category_id: categoryId }).in('id', ids)
      if (error) throw error
      return ids.length
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
  })
}

export function useBulkSetTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, isTransfer }: { ids: string[]; isTransfer: boolean }) => {
      if (ids.length === 0) return 0
      const supabase = requireSupabase()
      const { error } = await supabase.from('transactions').update({ is_transfer: isTransfer }).in('id', ids)
      if (error) throw error
      return ids.length
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
  })
}

export function useDeleteTransactions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0
      const supabase = requireSupabase()
      const { error } = await supabase.from('transactions').delete().in('id', ids)
      if (error) throw error
      return ids.length
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
  })
}
