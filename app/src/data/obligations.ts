import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages, normaliseRows } from './rows'
import { d, toDb, type Numeric } from '../lib/money'
import { nextOccurrence, type ISODate, type Recurrence } from '../lib/dates'
import type { Obligation, ObligationDirection, ObligationPayment, ObligationStatus } from '../types'

export function useObligations() {
  return useQuery({
    queryKey: queryKeys.obligations,
    queryFn: async (): Promise<Obligation[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<Obligation>((from, to) =>
        supabase
          .from('obligations')
          .select('*')
          .order('due_date', { ascending: true, nullsFirst: false })
          .range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], [
        'amount_total',
        'amount_settled',
      ]) as unknown as Obligation[]
    },
  })
}

export function useObligationPayments(obligationId?: string) {
  return useQuery({
    queryKey: queryKeys.obligationPayments(obligationId),
    enabled: Boolean(obligationId),
    queryFn: async (): Promise<ObligationPayment[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<ObligationPayment>((from, to) =>
        supabase
          .from('obligation_payments')
          .select('*')
          .eq('obligation_id', obligationId!)
          .order('paid_on', { ascending: false })
          .range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], [
        'amount',
      ]) as unknown as ObligationPayment[]
    },
  })
}

export interface ObligationInput {
  direction: ObligationDirection
  counterparty: string
  description: string | null
  amount_total: Numeric
  currency: string
  due_date: ISODate | null
  linked_account_id: string | null
  recurrence: Recurrence
  notes: string | null
}

export function useSaveObligation() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ObligationInput }) => {
      const supabase = requireSupabase()
      const row = { ...input, amount_total: toDb(input.amount_total) }

      if (id) {
        const { error } = await supabase.from('obligations').update(row).eq('id', id)
        if (error) throw error
        return id
      }

      const { data, error } = await supabase
        .from('obligations')
        .insert({ ...row, user_id: userId, amount_settled: toDb(0), status: 'open' })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDeleteObligation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('obligations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useUpdateObligationStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ObligationStatus }) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('obligations').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export interface RecordPaymentResult {
  settled: boolean
  /** Id of the next instance, when a recurring obligation rolled over. */
  nextInstanceId: string | null
}

/**
 * Record a payment against an obligation.
 *
 * The obligation's `amount_settled` and `status` are recalculated from the
 * payment rows rather than incremented, so a deleted or corrected payment can
 * never leave the running total drifting from its own history.
 *
 * When a recurring obligation is fully settled, the next instance is created
 * automatically — otherwise a monthly bill silently disappears the moment it
 * is paid.
 */
export function useRecordPayment() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({
      obligation,
      paidOn,
      amount,
    }: {
      obligation: Obligation
      paidOn: ISODate
      amount: Numeric
    }): Promise<RecordPaymentResult> => {
      const supabase = requireSupabase()

      const { error: paymentError } = await supabase.from('obligation_payments').insert({
        user_id: userId,
        obligation_id: obligation.id,
        paid_on: paidOn,
        amount: toDb(amount),
        currency: obligation.currency,
      })
      if (paymentError) throw paymentError

      const payments = await fetchAllPages<{ amount: number | string }>((from, to) =>
        supabase.from('obligation_payments').select('amount').eq('obligation_id', obligation.id).range(from, to),
      )
      const settledTotal = payments.reduce((sum, payment) => sum.plus(d(payment.amount)), d(0))
      const total = d(obligation.amount_total)

      const status: ObligationStatus = settledTotal.gte(total)
        ? 'settled'
        : settledTotal.gt(0)
          ? 'partial'
          : 'open'

      const { error: updateError } = await supabase
        .from('obligations')
        .update({ amount_settled: toDb(settledTotal), status })
        .eq('id', obligation.id)
      if (updateError) throw updateError

      let nextInstanceId: string | null = null

      if (status === 'settled' && obligation.recurrence !== 'none') {
        const base = obligation.due_date ?? paidOn
        const nextDue = nextOccurrence(base, obligation.recurrence)
        if (nextDue) {
          const { data, error } = await supabase
            .from('obligations')
            .insert({
              user_id: userId,
              direction: obligation.direction,
              counterparty: obligation.counterparty,
              description: obligation.description,
              amount_total: toDb(obligation.amount_total),
              currency: obligation.currency,
              amount_settled: toDb(0),
              due_date: nextDue,
              status: 'open',
              linked_account_id: obligation.linked_account_id,
              recurrence: obligation.recurrence,
              notes: obligation.notes,
            })
            .select('id')
            .single()
          if (error) throw error
          nextInstanceId = (data as { id: string }).id
        }
      }

      return { settled: status === 'settled', nextInstanceId }
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDeletePayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ payment, obligation }: { payment: ObligationPayment; obligation: Obligation }) => {
      const supabase = requireSupabase()

      const { error } = await supabase.from('obligation_payments').delete().eq('id', payment.id)
      if (error) throw error

      const payments = await fetchAllPages<{ amount: number | string }>((from, to) =>
        supabase.from('obligation_payments').select('amount').eq('obligation_id', obligation.id).range(from, to),
      )
      const settledTotal = payments.reduce((sum, entry) => sum.plus(d(entry.amount)), d(0))
      const total = d(obligation.amount_total)
      const status: ObligationStatus = settledTotal.gte(total)
        ? 'settled'
        : settledTotal.gt(0)
          ? 'partial'
          : 'open'

      const { error: updateError } = await supabase
        .from('obligations')
        .update({ amount_settled: toDb(settledTotal), status })
        .eq('id', obligation.id)
      if (updateError) throw updateError
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
