import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages, normaliseRows } from './rows'
import { toDb, toDbOrNull, type Numeric } from '../lib/money'
import { nextOccurrence, type Frequency, type ISODate, type Recurrence } from '../lib/dates'
import type { IncomeEvent, IncomeSource } from '../types'

export function useIncomeSources() {
  return useQuery({
    queryKey: queryKeys.incomeSources,
    queryFn: async (): Promise<IncomeSource[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<IncomeSource>((from, to) =>
        supabase.from('income_sources').select('*').order('name').range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], [
        'gross_amount',
      ]) as unknown as IncomeSource[]
    },
  })
}

export function useIncomeEvents() {
  return useQuery({
    queryKey: queryKeys.incomeEvents,
    queryFn: async (): Promise<IncomeEvent[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<IncomeEvent>((from, to) =>
        supabase.from('income_events').select('*').order('received_on', { ascending: false }).range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], [
        'gross_amount',
        'net_amount',
      ]) as unknown as IncomeEvent[]
    },
  })
}

export interface IncomeSourceInput {
  name: string
  employer: string | null
  gross_amount: Numeric | null
  currency: string
  frequency: Frequency
  next_expected_date: ISODate | null
  is_active: boolean
}

export function useSaveIncomeSource() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: IncomeSourceInput }) => {
      const supabase = requireSupabase()
      const row = { ...input, gross_amount: toDbOrNull(input.gross_amount) }

      if (id) {
        const { error } = await supabase.from('income_sources').update(row).eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase
        .from('income_sources')
        .insert({ ...row, user_id: userId })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources }),
  })
}

export function useDeleteIncomeSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('income_sources').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export interface IncomeEventInput {
  income_source_id: string | null
  received_on: ISODate
  gross_amount: Numeric | null
  net_amount: Numeric
  currency: string
  account_id: string | null
  transaction_id: string | null
}

/**
 * Record income received.
 *
 * When the event comes from a source with a known frequency, the source's
 * `next_expected_date` is rolled forward — otherwise "next expected" silently
 * goes stale and stops being useful the first time you get paid.
 */
export function useRecordIncomeEvent() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ input, source }: { input: IncomeEventInput; source?: IncomeSource | null }) => {
      const supabase = requireSupabase()

      const { error } = await supabase.from('income_events').insert({
        user_id: userId,
        income_source_id: input.income_source_id,
        received_on: input.received_on,
        gross_amount: toDbOrNull(input.gross_amount),
        net_amount: toDb(input.net_amount),
        currency: input.currency,
        account_id: input.account_id,
        transaction_id: input.transaction_id,
      })
      if (error) throw error

      if (source && source.frequency !== 'irregular') {
        const base = source.next_expected_date ?? input.received_on
        const next = nextOccurrence(base, source.frequency as Recurrence)
        if (next) {
          const { error: updateError } = await supabase
            .from('income_sources')
            .update({ next_expected_date: next })
            .eq('id', source.id)
          if (updateError) throw updateError
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDeleteIncomeEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('income_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.incomeEvents }),
  })
}

/** Attach an income event to the imported transaction that represents it. */
export function useMatchIncomeToTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ eventId, transactionId }: { eventId: string; transactionId: string | null }) => {
      const supabase = requireSupabase()
      const { error } = await supabase
        .from('income_events')
        .update({ transaction_id: transactionId })
        .eq('id', eventId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.incomeEvents }),
  })
}
